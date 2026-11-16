import { CHECKS, qualityCue, subjectCue, heardAs, type DecisionAnswer } from './checks';
import { cueText, guide, initialGuidance, tickIntervalMs, type Analysis, type Facing, type GuidanceState } from './guidance';
import type { LibraryWalk } from './library';
import { LOOK, type Check, type LookClient } from './lookClient';
import { gateScene, initialGate, markDescribed, type GateState } from './sceneGate';
import type { CameraVoice } from './voice';
import { whenTaken } from './whenTaken';

// Runs the camera and the photo library for a blind user: entering and leaving, permissions, the privacy
// question, framing cues and haptic ticks from the on-device measurements, descriptions of the view, quick checks
// for what the user asked about, the shutter, keep or take another, and walking the library. React-free, so the
// flows are unit tested with fakes; CameraScreen renders its state and forwards gestures and frames.

export type Phase = 'starting' | 'permission' | 'consent' | 'aiming' | 'unavailable' | 'capturing' | 'reviewing' | 'library' | 'closed';

export type Photo = { uri: string; width: number; height: number };

export type KeptPhoto = Photo & { mimeType: 'image/jpeg'; description: string | null; altText: string; source: 'camera' | 'library' };

export type FrameSource = {
  snapshot(maxDimension: number, mirror: boolean): Promise<string | null>;
  takePhoto(): Promise<Photo | null>;
};

export type CameraPermission = 'granted' | 'denied' | 'restricted' | 'undetermined' | 'unavailable';
export type LibraryPermission = 'granted' | 'limited' | 'denied' | 'undetermined';
export type Consent = 'yes' | 'no' | null;

export type ControllerDeps = {
  voice: CameraVoice;
  look: LookClient;
  library: LibraryWalk;
  permissions: {
    camera(): CameraPermission;
    requestCamera(): Promise<boolean>;
    library(): Promise<LibraryPermission>;
    requestLibrary(): Promise<LibraryPermission>;
  };
  consent: { get(): Promise<Consent>; set(answer: 'yes' | 'no'): Promise<void> };
  feedback: { tick(): void; shutter(): void; edge(): void; confirm(): void };
  photoImage(photo: Photo, maxPx: number): Promise<string | null>;
  forUpload(photo: Photo): Promise<Photo | null>;
  libraryPhoto(id: string): Promise<Photo | null>;
  onKeep(photo: KeptPhoto): void;
  onClose(): void;
  now(): number;
  schedule(run: () => void, ms: number): () => void;
  log(event: string, detail?: Record<string, unknown>): void;
};

export type CameraState = {
  phase: Phase;
  facing: Facing;
  // Large text over the preview for low-vision users: the current cue or what is happening.
  cue: string;
  // The last description, photo caption or library line.
  detail: string;
  descriptionsOn: boolean;
  // The library photo on screen, while the phase is library.
  libraryPhotoId: string | null;
  // Whether the voice agent is in a call, read again at every change.
  inCall: boolean;
};

export const messages = {
  enter: 'Camera. Draw a counter-clockwise circle to go back to your feed.',
  enterInCall: 'Camera. Say close the camera to go back to your feed.',
  controls: 'Tap the bottom half to take a picture, the top half to switch cameras.',
  cameraWhy: 'Juno needs the camera to tell you what is in front of you and to help you take pictures. iOS will ask now. Choose Allow.',
  cameraDenied: 'Camera access is off for Juno. To turn it on, open the Settings app, choose Juno, and turn on Camera. You can still choose from your photos.',
  cameraUnavailable: "This phone's camera isn't available. You can still choose from your photos.",
  consent:
    "To describe pictures, Juno sends them to OpenAI. Juno doesn't keep them. OpenAI may keep them for up to 30 days to check for misuse, then deletes them, and doesn't use them to train its models. To allow this, use the action Allow descriptions. To keep pictures on your phone, use the action Keep pictures on my phone. Framing help works either way.",
  consentInCall: "To describe pictures, Juno sends them to OpenAI. Juno doesn't keep them. OpenAI may keep them for up to 30 days to check for misuse, then deletes them, and doesn't use them to train its models. Say yes to allow this, or no to keep pictures on your phone. Framing help works either way.",
  consentYes: 'Descriptions are on.',
  consentNo: 'Pictures stay on your phone. You still get framing help, without descriptions.',
  descriptionsStopped: 'Descriptions are off. Pictures stay on your phone, and the photo descriptions saved on it are deleted.',
  descriptionsOff: 'Descriptions are off, so pictures stay on your phone. Use the action Turn descriptions on, or ask the agent, to change that.',
  noDescription: "I couldn't describe it just now.",
  front: 'Front camera.',
  back: 'Back camera.',
  shutterFailed: "The picture didn't work. Try again.",
  keepOrRetake: 'Keep it or take another? Tap the bottom half to keep it, the top half to take another.',
  retake: 'Okay. Take another.',
  keeping: 'Keeping it.',
  stillDescribing: 'Still describing it. One moment.',
  keepFailed: "That photo couldn't be prepared for posting. Try another.",
  libraryWhy: 'To describe your photos, Juno needs to see your photo library. iOS will ask now. Choose Allow Full Access.',
  libraryDenied: 'Photo access is off for Juno. To turn it on, open the Settings app, choose Juno, then Photos, and choose Full Access.',
  libraryEmpty: 'There are no photos in your library.',
  libraryLimited: 'Juno can see only the photos you selected. To choose more, open the Settings app, choose Juno, then Photos.',
  libraryLimitedEmpty: "Juno can see only the photos you selected, and none are selected. To choose some, open the Settings app, choose Juno, then Photos.",
  libraryNoDescriptions: 'Descriptions are off, so I read only when each photo was taken. To hear what is in them, use the action Turn descriptions on, or ask the agent.',
  libraryIntro: 'Your photos, newest first. Tap the bottom half for the next photo, the top half to go back. Press and hold to choose one.',
  newest: "That's the newest photo.",
  oldest: "That's the oldest photo.",
  loadingOlder: 'Loading older photos.',
  cameraStopped: 'The camera stopped. Close the camera and open it again.',
  choosing: 'Choosing this photo.',
  notAiming: 'Point the camera first.',
  stopChecking: (thing: string) => `I stopped checking for ${thing}. Ask again to keep checking.`,
  checking: (thing: string) => `Checking for ${thing}.`,
};

const devLog = process.env.EXPO_PUBLIC_DEV_FRAME_SOURCE === '1';

// With no frame for this long while aiming, the camera has stopped (a phone call, Siri, an error): the ticks stop.
export const FRAME_STALL_MS = 1500;

// After the iOS permission alert closes, speech started at once can be cut off as the app becomes active again (and
// VoiceOver re-reads the screen), so the next line waits this long.
export const AFTER_PROMPT_MS = 1000;

type Review = { photo: Photo; description: string | null; altText: string; pending: Promise<void> | null };

type Question = { subject: string; until: number; lastSaid: string | null };

export class CameraController {
  private state: CameraState = { phase: 'starting', facing: 'back', cue: '', detail: '', descriptionsOn: false, libraryPhotoId: null, inCall: false };
  private readonly listeners = new Set<(state: CameraState) => void>();
  private frames: FrameSource | null = null;
  private guidance: GuidanceState = initialGuidance();
  private gate: GateState = initialGate();
  private describing = false;
  private deciding = false;
  private lastCheckAt = -Infinity;
  private question: Question | null = null;
  private readyChecked = false;
  private tickInterval: number | null = null;
  private cancelTick: (() => void) | null = null;
  private consentAnswer: ((answer: 'yes' | 'no') => void) | null = null;
  private review: Review | null = null;
  private lastFrameAt = -Infinity;
  private stalled = false;
  private libraryNoticeGiven = false;
  private generation = 0;
  private hintGiven = false;
  private latest: Analysis | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  get snapshot(): CameraState {
    return this.state;
  }

  subscribe(listener: (state: CameraState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  attach(frames: FrameSource | null): void {
    this.frames = frames;
  }

  async start({ library = false }: { library?: boolean } = {}): Promise<void> {
    const generation = this.generation;
    const consent = await this.deps.consent.get();
    this.set({ descriptionsOn: consent === 'yes' });
    await this.deps.voice.speak(this.deps.voice.inCall() ? messages.enterInCall : messages.enter, 'status');
    if (generation !== this.generation) return;
    if (library) return this.openLibrary();
    if (!(await this.ensureCamera()) || generation !== this.generation) return;
    if (consent === null && !(await this.askConsent())) return;
    if (generation !== this.generation) return;
    this.startAiming();
  }

  stop(): void {
    this.generation += 1;
    this.stopTicks();
    this.consentAnswer = null;
    this.question = null;
    this.set({ phase: 'closed' });
  }

  close(): void {
    if (this.state.phase === 'closed') return;
    this.deps.voice.stop();
    this.stop();
    this.deps.onClose();
  }

  // The camera view reported it can't run (no camera on this phone, or access was turned off meanwhile).
  cameraFailed(reason: 'permission' | 'unavailable'): void {
    if (this.state.phase !== 'aiming') return;
    this.stopTicks();
    const detail = reason === 'permission' ? messages.cameraDenied : messages.cameraUnavailable;
    this.set({ phase: 'unavailable', detail, cue: reason === 'permission' ? 'No camera access' : 'No camera' });
    this.say(detail, 'status');
  }

  // Back from the photo library to aiming the camera.
  backToCamera(): void {
    if (this.state.phase !== 'library') return;
    this.deps.voice.stop();
    void this.start();
  }

  // Taps on the top and bottom halves; their meaning follows the phase and is spoken in each phase's hint.
  tapTop(): void {
    switch (this.state.phase) {
      case 'consent':
        return this.say(this.consentQuestion(), 'status');
      case 'aiming':
        return this.flip();
      case 'reviewing':
        return this.retake();
      case 'library':
        return void this.libraryMove('newer');
      case 'unavailable':
        return this.say(this.state.detail || messages.cameraUnavailable, 'status');
    }
  }

  tapBottom(): void {
    switch (this.state.phase) {
      case 'consent':
        return this.say(this.consentQuestion(), 'status');
      case 'aiming':
        return void this.shutter();
      case 'reviewing':
        return void this.keep();
      case 'library':
        return void this.libraryMove('older');
      case 'unavailable':
        return void this.openLibrary();
    }
  }

  longPress(): void {
    if (this.state.phase === 'library') void this.choose();
  }

  // Only from a named action (Allow descriptions, Keep pictures on my phone, Turn descriptions on or off) or the
  // agent's camera tool for a spoken answer: never from a tap or VoiceOver's double tap.
  answerConsent(answer: 'yes' | 'no'): void {
    if (this.consentAnswer) return this.consentAnswer(answer);
    const wasOn = this.state.descriptionsOn;
    this.recordConsent(answer);
    this.say(answer === 'yes' ? messages.consentYes : wasOn ? messages.descriptionsStopped : messages.consentNo, 'status');
  }

  // Remembered on the phone. Turning descriptions off stops what is in flight (each result is dropped when it
  // lands, see the descriptionsOn checks), stops a description being spoken, and deletes the saved descriptions.
  private recordConsent(answer: 'yes' | 'no'): void {
    void this.deps.consent.set(answer);
    this.set({ descriptionsOn: answer === 'yes' });
    if (answer === 'yes') return;
    this.question = null;
    this.deps.voice.stop();
    void this.deps.library.forget();
  }

  private consentQuestion(): string {
    return this.deps.voice.inCall() ? messages.consentInCall : messages.consent;
  }

  onAnalysis(analysis: Analysis): void {
    if (this.state.phase !== 'aiming') return;
    if (analysis.facing && analysis.facing !== this.state.facing) return;
    this.latest = analysis;
    const { voice } = this.deps;
    const now = this.deps.now();
    this.lastFrameAt = now;
    this.stalled = false;
    const busy = voice.busy() || this.describing;
    const { state, cue, assessment } = guide(this.guidance, analysis, { facing: this.state.facing, now, busy, keyOnly: voice.inCall() });
    this.guidance = state;
    this.setTicks(tickIntervalMs(assessment));
    const current = state.candidate ? cueText(state.candidate, this.state.facing, assessment.subject?.kind ?? null) : '';
    if (!cue && current && current !== this.state.cue) this.set({ cue: current });
    if (cue) {
      this.set({ cue: cue.text });
      void voice.speak(cue.text, cue.key ? 'keyCue' : 'cue');
      if (devLog) this.deps.log('cue', { cue: cue.text });
      if (cue.kind === 'ready' && !this.readyChecked) {
        this.readyChecked = true;
        void this.check(['quality']);
      }
    }
    if (!state.readySince) this.readyChecked = false;
    if (this.state.descriptionsOn) {
      const scene = { signature: analysis.signature, people: analysis.faces.length, motion: analysis.motion, now, busy: busy || voice.busy(), inflight: this.describing };
      const gated = gateScene(this.gate, scene);
      this.gate = gated.state;
      if (gated.describe) void this.describeView(false);
    }
    this.checkQuestion(now);
  }

  async describeView(asked: boolean): Promise<void> {
    if (!this.state.descriptionsOn) {
      if (asked) this.say(messages.descriptionsOff, 'status');
      return;
    }
    if (this.state.phase !== 'aiming' || !this.frames || this.describing) return;
    this.describing = true;
    const generation = this.generation;
    try {
      const image = await this.frames.snapshot(LOOK.describeMaxPx, this.state.facing === 'front');
      const result = image ? await this.deps.look.describe(image, 'view') : null;
      if (generation !== this.generation || this.state.phase !== 'aiming' || !this.state.descriptionsOn) return;
      if (!result) {
        if (asked) this.say(messages.noDescription, 'status');
        return;
      }
      if (devLog) this.deps.log('view described', { latencyMs: result.latencyMs, costUsd: result.costUsd, description: result.description });
      this.set({ detail: result.description });
      this.describing = false;
      await this.deps.voice.speak(result.description, 'description');
    } finally {
      this.describing = false;
    }
  }

  // "What do you see?": described now, whatever the scene gate would say, and the gate starts again from here.
  askWhatIsInView(): void {
    if (this.state.phase === 'library') return void this.presentLibraryPhoto(true);
    if (this.state.phase === 'reviewing') return this.say(this.review?.description ? `You took a photo of ${lowerFirst(this.review.description)}` : this.review?.pending ? messages.stillDescribing : messages.noDescription, 'status');
    if (this.state.phase !== 'aiming') return this.say(messages.notAiming, 'status');
    const now = this.deps.now();
    this.gate = this.latest ? markDescribed(this.gate, { signature: this.latest.signature, people: this.latest.faces.length, now }) : { ...this.gate, lastAt: now };
    void this.describeView(true);
  }

  // "Is my dog in the picture?" Checked about once a second for a while, only while this question stands.
  ask(subject: string): void {
    const thing = heardAs(subject);
    if (!this.state.descriptionsOn) return this.say(messages.descriptionsOff, 'status');
    if (this.state.phase !== 'aiming') return this.say(messages.notAiming, 'status');
    this.question = { subject: subject.trim(), until: this.deps.now() + CHECKS.questionMs, lastSaid: null };
    this.say(messages.checking(thing), 'status');
    this.lastCheckAt = -Infinity;
  }

  flip(): void {
    const facing: Facing = this.state.facing === 'back' ? 'front' : 'back';
    this.guidance = initialGuidance();
    this.gate = initialGate();
    this.lastFrameAt = this.deps.now();
    this.set({ facing, cue: '' });
    this.deps.feedback.confirm();
    this.say(facing === 'front' ? messages.front : messages.back, 'status');
  }

  async shutter(): Promise<void> {
    if (this.state.phase !== 'aiming') return this.say(messages.notAiming, 'status');
    if (!this.frames) return this.say(messages.shutterFailed, 'status');
    const generation = this.generation;
    this.stopTicks();
    this.set({ phase: 'capturing', cue: 'Taking the picture' });
    this.deps.feedback.shutter();
    const photo = await this.frames.takePhoto().catch(() => null);
    if (generation !== this.generation) return;
    if (!photo) {
      this.set({ phase: 'aiming', cue: '' });
      return this.say(messages.shutterFailed, 'status');
    }
    const review: Review = { photo, description: null, altText: '', pending: null };
    this.review = review;
    this.set({ phase: 'reviewing', cue: 'Keep it or take another?', detail: '' });
    let spoken = 'You took a photo.';
    if (this.state.descriptionsOn) {
      let problem: string | null = null;
      review.pending = this.describePhoto(review).then((found) => void (problem = found));
      await review.pending;
      review.pending = null;
      if (generation !== this.generation || this.review !== review) return;
      if (review.description) spoken = `You took a photo of ${lowerFirst(review.description)}`;
      if (problem) spoken = `${spoken} ${problem}`;
    }
    this.set({ detail: spoken });
    this.say(`${spoken} ${messages.keepOrRetake}`, 'status');
  }

  // Describes and checks the photo just taken, filling in review; resolves with a quality problem to mention.
  private async describePhoto(review: Review): Promise<string | null> {
    const { photo } = review;
    const [image, small] = await Promise.all([this.deps.photoImage(photo, LOOK.describeMaxPx), this.deps.photoImage(photo, LOOK.decideMaxPx)]);
    const subject = this.question?.subject ?? null;
    const [described, decided] = await Promise.all([
      image ? this.deps.look.describe(image, 'photo') : null,
      small ? this.deps.look.decide(small, subject, subject ? ['inView', 'cutOff', 'quality'] : ['quality']) : null,
    ]);
    if (!this.state.descriptionsOn) return null;
    if (devLog) this.deps.log('photo described', { latencyMs: described?.latencyMs, costUsd: described?.costUsd, description: described?.description, altText: described?.altText, decision: decided });
    if (described) {
      review.description = described.description;
      review.altText = described.altText || described.description;
    }
    return decided ? qualityCue(decided) : null;
  }

  // A photo kept before its description arrived waits for it (the description service has its own timeout), so
  // the post gets its alt text.
  async keep(): Promise<void> {
    const review = this.review;
    if (this.state.phase !== 'reviewing' || !review) return;
    this.deps.feedback.confirm();
    if (review.pending) {
      this.say(messages.stillDescribing, 'status');
      await review.pending;
      if (this.review !== review || this.state.phase !== 'reviewing') return;
    }
    this.say(messages.keeping, 'status');
    const ready = await this.deps.forUpload(review.photo);
    if (this.review !== review) return;
    if (!ready) return this.say(messages.keepFailed, 'status');
    this.review = null;
    this.handOver({ ...ready, mimeType: 'image/jpeg', description: review.description, altText: review.altText, source: 'camera' });
  }

  retake(): void {
    if (this.state.phase !== 'reviewing') return;
    this.review = null;
    this.say(messages.retake, 'status');
    this.startAiming();
  }

  async openLibrary(): Promise<void> {
    const generation = this.generation;
    this.stopTicks();
    let permission = await this.deps.permissions.library();
    if (permission === 'undetermined') {
      this.set({ phase: 'permission' });
      await this.deps.voice.speak(messages.libraryWhy, 'status');
      permission = await this.deps.permissions.requestLibrary();
    }
    if (generation !== this.generation) return;
    if (permission === 'denied' || permission === 'undetermined') {
      this.set({ phase: 'unavailable', detail: messages.libraryDenied, cue: 'No photo access' });
      return this.say(messages.libraryDenied, 'status');
    }
    const limited = permission === 'limited';
    if (this.state.descriptionsOn === false && (await this.deps.consent.get()) === null && !(await this.askConsent())) return;
    const count = await this.deps.library.load().catch(() => 0);
    if (generation !== this.generation) return;
    if (!count) {
      const empty = limited ? messages.libraryLimitedEmpty : messages.libraryEmpty;
      this.set({ phase: 'unavailable', detail: empty, cue: 'No photos' });
      return this.say(empty, 'status');
    }
    this.set({ phase: 'library', cue: '' });
    const notice = !this.state.descriptionsOn && !this.libraryNoticeGiven ? messages.libraryNoDescriptions : null;
    if (notice) this.libraryNoticeGiven = true;
    await this.deps.voice.speak([messages.libraryIntro, limited ? messages.libraryLimited : null, notice].filter(Boolean).join(' '), 'status');
    if (generation === this.generation) void this.presentLibraryPhoto(false);
  }

  async libraryMove(direction: 'older' | 'newer'): Promise<void> {
    if (this.state.phase !== 'library') return;
    const { library } = this.deps;
    let moved = library.move(direction);
    if (moved === 'atEnd' && library.hasMore) {
      const loaded = await library.more().catch(() => false);
      if (this.state.phase !== 'library') return;
      if (loaded) moved = library.move(direction);
    }
    if (moved !== 'moved') {
      this.deps.feedback.edge();
      return this.say(moved === 'atStart' ? messages.newest : messages.oldest, 'status');
    }
    this.deps.feedback.confirm();
    void this.presentLibraryPhoto(false);
  }

  async choose(): Promise<void> {
    const { library } = this.deps;
    const photo = library.current();
    if (this.state.phase !== 'library' || !photo) return;
    this.say(messages.choosing, 'status');
    this.deps.feedback.confirm();
    const [file, described] = await Promise.all([this.deps.libraryPhoto(photo.id), library.describeCurrent()]);
    const ready = file ? await this.deps.forUpload(file) : null;
    if (this.state.phase !== 'library' || library.current() !== photo) return;
    if (!ready) return this.say(messages.keepFailed, 'status');
    this.handOver({ ...ready, mimeType: 'image/jpeg', description: described?.description ?? null, altText: described?.altText || described?.description || '', source: 'library' });
  }

  private handOver(photo: KeptPhoto): void {
    this.stop();
    this.deps.onKeep(photo);
  }

  private async presentLibraryPhoto(asked: boolean): Promise<void> {
    const { library } = this.deps;
    const photo = library.current();
    if (!photo) return;
    const position = library.position;
    const when = whenTaken(new Date(photo.takenAt), new Date(this.deps.now()));
    const cached = await library.cached(photo);
    if (library.current() !== photo || this.state.phase !== 'library') return;
    if (cached || !this.state.descriptionsOn) {
      const line = cached ? `${when}. ${upperFirst(cached.description)}` : `${when}.`;
      this.set({ detail: line, cue: photoCount(position, library), libraryPhotoId: photo.id });
      void library.describeCurrent();
      if (devLog) this.deps.log('library photo', { position: position + 1, line, cached: !!cached });
      return this.say(line, 'status');
    }
    this.set({ detail: `${when}.`, cue: photoCount(position, library), libraryPhotoId: photo.id });
    this.say(`${when}.`, 'status');
    const started = this.deps.now();
    const described = await library.describeCurrent();
    if (library.current() !== photo || this.state.phase !== 'library' || !this.state.descriptionsOn) return;
    if (!described) return asked ? this.say(messages.noDescription, 'status') : undefined;
    const line = `${when}. ${upperFirst(described.description)}`;
    this.set({ detail: line });
    if (devLog) this.deps.log('library photo', { position: position + 1, line, waitedMs: this.deps.now() - started });
    void this.deps.voice.speak(upperFirst(described.description), 'description');
  }

  private startAiming(): void {
    this.lastFrameAt = this.deps.now();
    this.stalled = false;
    this.guidance = initialGuidance();
    this.gate = initialGate();
    this.readyChecked = false;
    this.set({ phase: 'aiming', cue: '' });
    if (!this.hintGiven) {
      this.hintGiven = true;
      this.say(messages.controls, 'status');
    }
  }

  private async ensureCamera(): Promise<boolean> {
    let status = this.deps.permissions.camera();
    if (status === 'undetermined') {
      this.set({ phase: 'permission' });
      await this.deps.voice.speak(messages.cameraWhy, 'status');
      status = (await this.deps.permissions.requestCamera()) ? 'granted' : 'denied';
      await new Promise<void>((resolve) => this.deps.schedule(resolve, AFTER_PROMPT_MS));
    }
    if (status === 'granted') return true;
    const detail = status === 'unavailable' ? messages.cameraUnavailable : messages.cameraDenied;
    this.set({ phase: 'unavailable', detail, cue: status === 'unavailable' ? 'No camera' : 'No camera access' });
    this.say(detail, 'status');
    return false;
  }

  // Waits for a deliberate answer; the line confirming it is heard in full before the camera says anything else.
  private askConsent(): Promise<boolean> {
    const generation = this.generation;
    this.set({ phase: 'consent', cue: 'Allow descriptions?' });
    this.say(this.consentQuestion(), 'status');
    return new Promise((resolve) => {
      this.consentAnswer = (answer) => {
        this.consentAnswer = null;
        this.recordConsent(answer);
        void this.deps.voice.speak(answer === 'yes' ? messages.consentYes : messages.consentNo, 'status').then(() => resolve(generation === this.generation));
      };
    });
  }

  private checkQuestion(now: number): void {
    const question = this.question;
    if (!question || this.deciding || now - this.lastCheckAt < CHECKS.intervalMs) return;
    if (now > question.until) {
      this.question = null;
      return this.say(messages.stopChecking(heardAs(question.subject)), 'keyCue');
    }
    void this.check(['inView', 'cutOff', 'quality']);
  }

  private async check(checks: Check[]): Promise<void> {
    if (!this.frames || this.deciding || !this.state.descriptionsOn) return;
    this.deciding = true;
    this.lastCheckAt = this.deps.now();
    const question = this.question;
    const generation = this.generation;
    try {
      const image = await this.frames.snapshot(LOOK.decideMaxPx, this.state.facing === 'front');
      const subject = question?.subject ?? null;
      const answer = image ? await this.deps.look.decide(image, subject, subject ? checks : checks.filter((check) => check === 'quality')) : null;
      if (!answer || generation !== this.generation || this.state.phase !== 'aiming' || !this.state.descriptionsOn) return;
      if (devLog) this.deps.log('checked', { latencyMs: answer.latencyMs, costUsd: answer.costUsd, answer: { inView: answer.inView, cutOff: answer.cutOff, tooDark: answer.tooDark, tooBlurry: answer.tooBlurry } });
      this.speakCheck(answer, question);
    } finally {
      this.deciding = false;
    }
  }

  private speakCheck(answer: DecisionAnswer, question: Question | null): void {
    const said = [question ? subjectCue(answer, question.subject) : null, qualityCue(answer)].filter((line): line is string => !!line).join(' ');
    if (!said || this.deps.voice.busy()) return;
    if (question) {
      if (said === question.lastSaid) return;
      question.lastSaid = said;
    }
    this.set({ detail: said });
    void this.deps.voice.speak(said, 'keyCue');
  }

  private setTicks(interval: number | null): void {
    this.tickInterval = interval;
    if (interval === null) return this.stopTicks();
    if (this.cancelTick) return;
    const loop = () => {
      if (this.tickInterval === null || this.state.phase !== 'aiming') {
        this.cancelTick = null;
        return;
      }
      if (this.deps.now() - this.lastFrameAt > FRAME_STALL_MS) {
        this.cancelTick = null;
        this.tickInterval = null;
        if (this.stalled) return;
        this.stalled = true;
        this.set({ cue: 'The camera stopped' });
        return this.say(messages.cameraStopped, 'keyCue');
      }
      this.deps.feedback.tick();
      this.cancelTick = this.deps.schedule(loop, this.tickInterval);
    };
    this.cancelTick = this.deps.schedule(loop, interval);
  }

  private stopTicks(): void {
    this.tickInterval = null;
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private say(text: string, kind: 'status' | 'keyCue'): void {
    void this.deps.voice.speak(text, kind);
  }

  private set(patch: Partial<CameraState>): void {
    const next = { ...this.state, ...patch, inCall: this.deps.voice.inCall() };
    this.state = next.phase === 'library' ? next : { ...next, libraryPhotoId: null };
    this.listeners.forEach((listener) => listener(this.state));
  }
}

const photoCount = (position: number, library: LibraryWalk) => (library.hasMore ? `Photo ${position + 1}` : `Photo ${position + 1} of ${library.count}`);
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string) => (/^[A-Z](?![A-Z])/.test(text) && !/^I\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
