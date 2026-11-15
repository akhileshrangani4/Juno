import type { Narrator } from '@/narration/Narrator';
import { createMemoryStore } from '@/storage/keyValueStore';

import { CameraController, messages, type ControllerDeps, type Consent, type FrameSource, type KeptPhoto } from '../CameraController';
import type { Analysis, Box } from '../guidance';
import { DescriptionStore, LibraryWalk, type LibrarySource } from '../library';
import type { LookClient } from '../lookClient';
import { CameraVoice } from '../voice';

const box = (cx: number, cy: number, size = 0.3): Box => ({ x: cx - size / 2, y: cy - size / 2, width: size, height: size });
const flat = (value: number) => Array.from({ length: 64 }, () => value);
const frame = (overrides: Partial<Analysis> = {}): Analysis => ({ faces: [box(0.5, 0.5)], salient: null, sharpness: 200, brightness: 0.5, motion: 0, signature: flat(0.5), at: 0, ...overrides });

function setup({ camera = 'granted', consent = 'yes' as Consent, live = false, library = 'granted', requestCamera = true } = {}) {
  let now = 0;
  const spoken: string[] = [];
  const said: string[] = [];
  let doneListeners = new Set<() => void>();
  const narrator: Narrator = {
    speak: jest.fn((text: string) => void spoken.push(text)),
    append: jest.fn(),
    stop: jest.fn(),
    speaking: () => false,
    setRate: jest.fn(),
    onDone: (listener) => {
      doneListeners.add(listener);
      return () => void doneListeners.delete(listener);
    },
  };
  const schedule = (run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  };
  const voice = new CameraVoice({ narrator, agent: { live: () => live, say: (text) => (said.push(text), live) }, now: () => now, schedule });
  const look: jest.Mocked<LookClient> = {
    describe: jest.fn(async (_image, purpose) => ({
      description: purpose === 'photo' ? 'A red mug on a wooden desk.' : purpose === 'library' ? 'Two people at a table outdoors.' : 'A desk with a red mug in the middle.',
      altText: purpose === 'view' ? '' : 'A red mug with a white handle on a wooden desk.',
      visibleText: [],
      latencyMs: 900,
      costUsd: 0.0004,
    })),
    decide: jest.fn<ReturnType<LookClient['decide']>, Parameters<LookClient['decide']>>(async () => ({ inView: 0.9, cutOff: 'right' as const, tooDark: 0.1, tooBlurry: 0.1, latencyMs: 300, costUsd: 0.0001 })),
  };
  const frames: jest.Mocked<FrameSource> = {
    snapshot: jest.fn<ReturnType<FrameSource['snapshot']>, Parameters<FrameSource['snapshot']>>(async () => 'base64-frame'),
    takePhoto: jest.fn(async () => ({ uri: 'file:///photo.jpg', width: 3024, height: 4032 })),
  };
  const source: LibrarySource = {
    page: async () => ({
      photos: [
        { id: 'a', uri: 'ph://a', takenAt: new Date(2026, 10, 14, 15).getTime(), width: 4000, height: 3000 },
        { id: 'b', uri: 'ph://b', takenAt: new Date(2026, 10, 11, 19).getTime(), width: 4000, height: 3000 },
      ],
      next: null,
    }),
    image: async (photo) => `jpeg-${photo.id}`,
  };
  const order: string[] = [];
  let consentValue = consent;
  const consentStore = { get: jest.fn(async () => consentValue), set: jest.fn(async (answer: 'yes' | 'no') => void (consentValue = answer)) };
  const holder: { controller: CameraController | null } = { controller: null };
  const deps: ControllerDeps = {
    voice,
    look,
    library: new LibraryWalk({ source, store: new DescriptionStore(createMemoryStore()), describe: (image) => look.describe(image, 'library'), allowed: () => holder.controller?.snapshot.descriptionsOn ?? false }),
    permissions: {
      camera: jest.fn(() => camera as never),
      requestCamera: jest.fn(async () => (order.push('camera prompt'), requestCamera)),
      library: jest.fn(async () => library as never),
      requestLibrary: jest.fn(async () => (order.push('library prompt'), 'granted' as const)),
    },
    consent: consentStore,
    feedback: { tick: jest.fn(), shutter: jest.fn(), edge: jest.fn(), confirm: jest.fn() },
    photoImage: jest.fn(async (_photo: unknown, maxPx: number) => `base64-photo-${maxPx}`),
    forUpload: jest.fn(async (photo) => ({ ...photo, uri: 'file:///upload.jpg' })),
    libraryPhoto: jest.fn(async () => ({ uri: 'file:///library.jpg', width: 4000, height: 3000 })),
    onKeep: jest.fn(),
    onClose: jest.fn(),
    now: () => now,
    schedule,
    log: jest.fn(),
  };
  (narrator.speak as jest.Mock).mockImplementation((text: string) => {
    spoken.push(text);
    order.push(`say: ${text}`);
  });
  const controller = new CameraController(deps);
  holder.controller = controller;
  controller.attach(frames);
  const advance = async (ms: number) => {
    now += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };
  // Every spoken line finishes at once, as if the listener heard it.
  const finishSpeech = () => {
    const listeners = doneListeners;
    doneListeners = new Set();
    listeners.forEach((listener) => listener());
  };
  const feed = async (analysis: Analysis, ms: number, step = 125) => {
    for (let t = 0; t < ms; t += step) {
      controller.onAnalysis(analysis);
      await advance(step);
    }
  };
  return { controller, deps, look, frames, spoken, said, order, consentStore, advance, finishSpeech, feed, now: () => now };
}

// Lets every spoken line finish and time pass (up to a minute, in call the agent's speech is timed) until run settles.
const settle = async (env: ReturnType<typeof setup>, run: Promise<unknown>) => {
  let done = false;
  void run.finally(() => (done = true));
  for (let i = 0; i < 20 || (!done && i < 600); i++) {
    env.finishSpeech();
    await env.advance(i < 20 ? 10 : 100);
  }
  await run;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('entering the camera', () => {
  it('says where the user is and how to leave, then how the halves work, and starts aiming', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    expect(env.spoken.slice(0, 2)).toEqual([messages.enter, messages.controls]);
    expect(env.controller.snapshot.phase).toBe('aiming');
  });

  it('says how to leave by voice during a call, through the agent only', async () => {
    const env = setup({ live: true });
    await settle(env, env.controller.start());
    expect(env.said[0]).toBe(messages.enterInCall);
    expect(env.spoken).toEqual([]);
  });

  it('explains the camera before the iOS prompt, and how to fix a denial in Settings', async () => {
    const env = setup({ camera: 'undetermined', requestCamera: false });
    await settle(env, env.controller.start());
    expect(env.order.indexOf(`say: ${messages.cameraWhy}`)).toBeLessThan(env.order.indexOf('camera prompt'));
    expect(env.spoken).toContain(messages.cameraDenied);
    expect(env.controller.snapshot.phase).toBe('unavailable');
  });

  it('asks once before any picture leaves the phone, and keeps the answer', async () => {
    const env = setup({ consent: null });
    const started = env.controller.start();
    await settle(env, Promise.resolve());
    expect(env.controller.snapshot.phase).toBe('consent');
    expect(env.spoken).toContain(messages.consent);
    env.controller.answerConsent('no');
    await settle(env, started);
    expect(env.consentStore.set).toHaveBeenCalledWith('no');
    expect(env.controller.snapshot.phase).toBe('aiming');
    expect(env.spoken).toContain(messages.consentNo);
  });

  it('after a no, gives only on-device guidance and never sends a frame', async () => {
    const env = setup({ consent: 'no' });
    await settle(env, env.controller.start());
    await env.feed(frame({ faces: [box(0.9, 0.5)] }), 12_000);
    env.controller.askWhatIsInView();
    env.controller.ask('my dog');
    await settle(env, Promise.resolve());
    expect(env.look.describe).not.toHaveBeenCalled();
    expect(env.look.decide).not.toHaveBeenCalled();
    expect(env.frames.snapshot).not.toHaveBeenCalled();
    expect(env.spoken).toContain('Move right.');
    expect(env.spoken).toContain(messages.descriptionsOff);
  });
});

describe('consent and the entry line', () => {
  it('is never given by a tap or a double tap: those repeat the question', async () => {
    const env = setup({ consent: null });
    const started = env.controller.start();
    await settle(env, Promise.resolve());
    env.controller.tapTop();
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    expect(env.controller.snapshot.phase).toBe('consent');
    expect(env.consentStore.set).not.toHaveBeenCalled();
    expect(env.spoken.filter((line) => line === messages.consent)).toHaveLength(3);
    env.controller.answerConsent('yes');
    await settle(env, started);
    expect(env.consentStore.set).toHaveBeenCalledWith('yes');
    expect(env.controller.snapshot).toMatchObject({ phase: 'aiming', descriptionsOn: true });
  });

  it('names OpenAI, how long it may keep pictures, and no training, in the question', () => {
    expect(messages.consent).toMatch(/OpenAI.*30 days.*train/);
    expect(messages.consentInCall).toMatch(/OpenAI.*30 days.*train/);
    expect(messages.consent).toContain('Allow descriptions');
  });

  it('lets the entry line finish before anything else is said', async () => {
    const env = setup();
    const started = env.controller.start();
    await env.advance(1000);
    expect(env.spoken).toEqual([messages.enter]);
    await settle(env, started);
    expect(env.spoken.slice(0, 2)).toEqual([messages.enter, messages.controls]);
  });

  it('turning descriptions off drops a description on its way, stops speech, and deletes saved descriptions', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    let answer: (value: Awaited<ReturnType<LookClient['describe']>>) => void = () => undefined;
    env.look.describe.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const forget = jest.spyOn(env.deps.library, 'forget');
    const stop = jest.spyOn(env.deps.voice, 'stop');
    env.controller.askWhatIsInView();
    await env.advance(10);
    env.controller.answerConsent('no');
    answer({ description: 'A person at a desk.', altText: '', visibleText: [], latencyMs: 900, costUsd: 0.0002 });
    await settle(env, Promise.resolve());
    expect(env.spoken).not.toContain('A person at a desk.');
    expect(env.spoken).toContain(messages.descriptionsStopped);
    expect(stop).toHaveBeenCalled();
    expect(forget).toHaveBeenCalled();
    expect(env.consentStore.set).toHaveBeenLastCalledWith('no');
  });
});

describe('aiming', () => {
  it('ignores a frame from the other camera while switching', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame({ faces: [box(0.9, 0.5)], facing: 'front' }), 3000);
    expect(env.spoken).not.toContain('Move right.');
    expect(env.controller.snapshot.cue).toBe('');
  });

  it('keeps the large cue on screen current with every frame, even when nothing is spoken', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame({ faces: [box(0.9, 0.5)] }), 2000);
    expect(env.controller.snapshot.cue).toBe('Move right.');
    env.controller.onAnalysis(frame({ faces: [box(0.1, 0.5)] }));
    expect(env.controller.snapshot.cue).toBe('Move left.');
  });

  it('stops the ticks and says so once when frames stop coming', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame({ faces: [box(0.9, 0.5)] }), 1000);
    const tick = env.deps.feedback.tick as jest.Mock;
    await settle(env, Promise.resolve());
    await env.advance(5000);
    const ticks = tick.mock.calls.length;
    await env.advance(5000);
    expect(tick.mock.calls.length).toBe(ticks);
    expect(env.spoken.filter((line) => line === messages.cameraStopped)).toHaveLength(1);
    expect(env.controller.snapshot.cue).toBe('The camera stopped');
  });

  it('describes the view on entering, then not again while it stays the same', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame(), 30_000);
    expect(env.look.describe).toHaveBeenCalledTimes(1);
    expect(env.look.describe).toHaveBeenCalledWith('base64-frame', 'view');
    expect(env.spoken).toContain('A desk with a red mug in the middle.');
  });

  it('describes when asked, whatever the gate says', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame(), 3000);
    env.controller.askWhatIsInView();
    await settle(env, Promise.resolve());
    expect(env.look.describe).toHaveBeenCalledTimes(2);
  });

  it('ticks faster as the subject nears the center and stops when it is centered and steady', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    const tick = env.deps.feedback.tick as jest.Mock;
    await env.feed(frame({ faces: [box(0.95, 0.5)] }), 4000);
    const far = tick.mock.calls.length;
    tick.mockClear();
    await env.feed(frame({ faces: [box(0.65, 0.5)] }), 4000);
    const near = tick.mock.calls.length;
    tick.mockClear();
    await env.feed(frame(), 4000);
    expect(near).toBeGreaterThan(far);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('checks what the user asked about about once a second, says what changed, and stops after a while', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    env.controller.ask('the sign');
    await env.feed(frame(), 5000);
    const calls = env.look.decide.mock.calls.filter(([, subject]) => subject === 'the sign').length;
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(calls).toBeLessThanOrEqual(6);
    expect(env.spoken.filter((line) => line === 'Part of the sign is cut off on the right. Move right.')).toHaveLength(1);
    await env.feed(frame(), 45_000);
    expect(env.spoken).toContain(messages.stopChecking('the sign'));
    const total = env.look.decide.mock.calls.length;
    await env.feed(frame(), 10_000);
    expect(env.look.decide.mock.calls.length).toBe(total);
  });

  it('sends no check while nobody asked anything, except one quality check when the shot is ready', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await env.feed(frame(), 20_000);
    expect(env.look.decide.mock.calls.map(([, subject, checks]) => [subject, checks])).toEqual([[null, ['quality']]]);
  });

  it('mirrors front-camera frames before they are sent, so left and right are the user\'s', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    env.controller.flip();
    expect(env.spoken).toContain(messages.front);
    await env.feed(frame(), 3000);
    expect(env.frames.snapshot).toHaveBeenCalledWith(768, true);
  });
});

describe('the shutter, keep or take another', () => {
  it('gives a haptic and a sound, describes the photo actually taken, and asks keep or take another', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await settle(env, env.controller.shutter());
    expect(env.deps.feedback.shutter).toHaveBeenCalled();
    expect(env.deps.photoImage).toHaveBeenCalledWith({ uri: 'file:///photo.jpg', width: 3024, height: 4032 }, 768);
    expect(env.look.describe).toHaveBeenCalledWith('base64-photo-768', 'photo');
    expect(env.look.decide).toHaveBeenCalledWith('base64-photo-512', null, ['quality']);
    expect(env.spoken).toContain(`You took a photo of a red mug on a wooden desk. ${messages.keepOrRetake}`);
    expect(env.controller.snapshot.phase).toBe('reviewing');
  });

  it('keeps it: hands the upload-ready photo and its alt text to the publishing flow', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await settle(env, env.controller.shutter());
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    expect(env.deps.onKeep).toHaveBeenCalledWith<[KeptPhoto]>({
      uri: 'file:///upload.jpg',
      width: 3024,
      height: 4032,
      mimeType: 'image/jpeg',
      description: 'A red mug on a wooden desk.',
      altText: 'A red mug with a white handle on a wooden desk.',
      source: 'camera',
    });
    expect(env.controller.snapshot.phase).toBe('closed');
  });

  it('keeping before the description is back waits for it, so the post gets its alt text', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    let answer: (value: Awaited<ReturnType<LookClient['describe']>>) => void = () => undefined;
    env.look.describe.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const shot = env.controller.shutter();
    await settle(env, Promise.resolve());
    expect(env.controller.snapshot.phase).toBe('reviewing');
    const kept = env.controller.keep();
    await settle(env, Promise.resolve());
    expect(env.spoken).toContain(messages.stillDescribing);
    expect(env.deps.onKeep).not.toHaveBeenCalled();
    answer({ description: 'A blue bicycle.', altText: 'A blue bicycle by a wall.', visibleText: [], latencyMs: 900, costUsd: 0.0002 });
    await settle(env, Promise.all([shot, kept]));
    expect(env.deps.onKeep).toHaveBeenCalledWith(expect.objectContaining({ altText: 'A blue bicycle by a wall.' }));
  });

  it('takes another: back to aiming with nothing kept', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    await settle(env, env.controller.shutter());
    env.controller.tapTop();
    expect(env.controller.snapshot.phase).toBe('aiming');
    expect(env.spoken).toContain(messages.retake);
    expect(env.deps.onKeep).not.toHaveBeenCalled();
  });

  it('says so when the picture fails and keeps aiming', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    env.frames.takePhoto.mockResolvedValueOnce(null);
    await settle(env, env.controller.shutter());
    expect(env.spoken).toContain(messages.shutterFailed);
    expect(env.controller.snapshot.phase).toBe('aiming');
  });

  it('warns when the photo is too dark to post', async () => {
    const env = setup();
    env.look.decide.mockResolvedValue({ inView: null, cutOff: null, tooDark: 0.95, tooBlurry: 0.1, latencyMs: 300, costUsd: 0.0001 });
    await settle(env, env.controller.start());
    await settle(env, env.controller.shutter());
    expect(env.spoken.at(-1)).toContain("It's too dark to post. Find more light.");
  });
});

describe('the photo library', () => {
  it('explains before the iOS prompt, then walks the photos with when each was taken and a description', async () => {
    const env = setup({ library: 'undetermined' });
    jest.setSystemTime(new Date(2026, 10, 15, 16));
    await settle(env, env.controller.start({ library: true }));
    expect(env.order.indexOf(`say: ${messages.libraryWhy}`)).toBeLessThan(env.order.indexOf('library prompt'));
    expect(env.controller.snapshot.phase).toBe('library');
  });

  it('names the photo on screen in its state, so the screen shows the photo being read', async () => {
    const env = setup();
    await settle(env, env.controller.start({ library: true }));
    expect(env.controller.snapshot.libraryPhotoId).toBe('a');
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    expect(env.controller.snapshot.libraryPhotoId).toBe('b');
    env.controller.close();
    expect(env.controller.snapshot.libraryPhotoId).toBeNull();
  });

  it('starts a description that comes back in lower case with a capital, after the date', async () => {
    const env = setup();
    env.look.describe.mockImplementation(async () => ({ description: 'a broad waterfall in a misty gorge.', altText: '', visibleText: [], latencyMs: 900, costUsd: 0.0002 }));
    await settle(env, env.controller.start({ library: true }));
    expect(env.controller.snapshot.detail).toMatch(/\. A broad waterfall in a misty gorge\.$/);
  });

  it('chooses a photo by press and hold, with its description as alt text', async () => {
    const env = setup();
    await settle(env, env.controller.start({ library: true }));
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    env.controller.longPress();
    await settle(env, Promise.resolve());
    expect(env.deps.libraryPhoto).toHaveBeenCalledWith('b');
    expect(env.deps.onKeep).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///upload.jpg', altText: 'A red mug with a white handle on a wooden desk.', source: 'library' }));
  });

  it('says so at either end', async () => {
    const env = setup();
    await settle(env, env.controller.start({ library: true }));
    env.controller.tapTop();
    expect(env.spoken).toContain(messages.newest);
    expect(env.deps.feedback.edge).toHaveBeenCalled();
  });

  it('says when Juno sees only the photos the user selected, and what to do when none are', async () => {
    const env = setup({ library: 'limited' });
    await settle(env, env.controller.start({ library: true }));
    expect(env.spoken.some((line) => line.includes(messages.libraryLimited))).toBe(true);
    const empty = setup({ library: 'limited' });
    jest.spyOn(empty.deps.library, 'load').mockResolvedValue(0);
    await settle(empty, empty.controller.start({ library: true }));
    expect(empty.spoken).toContain(messages.libraryLimitedEmpty);
  });

  it('with descriptions off, says once that only dates are read, and offers to turn them on', async () => {
    const env = setup({ consent: 'no' });
    await settle(env, env.controller.start({ library: true }));
    expect(env.spoken.filter((line) => line.includes(messages.libraryNoDescriptions))).toHaveLength(1);
    expect(env.look.describe).not.toHaveBeenCalled();
    env.controller.close();
    await settle(env, env.controller.start({ library: true }));
    expect(env.spoken.filter((line) => line.includes(messages.libraryNoDescriptions))).toHaveLength(1);
  });

  it('says so at the oldest photo', async () => {
    const env = setup();
    await settle(env, env.controller.start({ library: true }));
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    env.controller.tapBottom();
    await settle(env, Promise.resolve());
    expect(env.spoken).toContain(messages.oldest);
  });

  it('explains a denial and how to fix it', async () => {
    const env = setup({ library: 'denied' });
    await settle(env, env.controller.start({ library: true }));
    expect(env.spoken).toContain(messages.libraryDenied);
  });
});

describe('leaving', () => {
  it('closes on request and stops everything', async () => {
    const env = setup();
    await settle(env, env.controller.start());
    env.controller.close();
    expect(env.deps.onClose).toHaveBeenCalled();
    await env.feed(frame({ faces: [box(0.9, 0.5)] }), 5000);
    expect(env.deps.feedback.tick).not.toHaveBeenCalled();
  });
});
