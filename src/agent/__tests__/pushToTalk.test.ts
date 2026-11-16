import { setup as setupTools } from '@/testing/agent';
import { createMemoryStore } from '@/storage/keyValueStore';
import { PRESS, PressTracker } from '@/gestures/press';

import { agentMessages } from '../agentMessages';
import { AgentSession } from '../AgentSession';
import { buildAssistant, FIRST_MESSAGE, HOLD_TO_TALK, PUSH_TO_TALK_SILENCE_SECONDS, SILENCE_TIMEOUT_SECONDS, VAPI_MAX_IDLE_SECONDS } from '../assistant';
import { ListeningModeStore, OPEN_POLL_MS, RELEASE_TAIL_MS, withPushToTalk, type ListeningMode } from '../listeningMode';
import type { CallListener, VapiMessage } from '../voiceCall';

function world(mode: ListeningMode) {
  const tools = setupTools({ readBacksHeard: false });
  const storage = createMemoryStore();
  const listening = new ListeningModeStore(storage);
  if (mode === 'handsFree') listening.set('handsFree');
  let listener: CallListener | null = null;
  const raw = {
    start: jest.fn((_assistant: object, next: CallListener) => {
      listener = next;
      return Promise.resolve();
    }),
    stop: jest.fn(),
    say: jest.fn(),
    addMessage: jest.fn(),
    muteCustomer: jest.fn(),
    muteAssistant: jest.fn(),
  };
  const cues: boolean[] = [];
  const logs: string[] = [];
  const ptt = withPushToTalk(raw, listening, {
    cue: (on) => cues.push(on),
    openWhile: () => tools.handlers.publisher.busy,
    schedule: tools.scheduler.schedule,
    now: tools.scheduler.now,
    log: (event, detail) => logs.push(detail ? `${event} ${JSON.stringify(detail)}` : event),
  });
  tools.deps.listening = listening;
  const session = new AgentSession({
    call: ptt.call,
    handlers: tools.handlers,
    conversation: tools.conversation,
    microphone: async () => 'granted',
    assistant: async () => ({ name: 'test' }),
    status: () => undefined,
    connecting: () => undefined,
    listening: () => undefined,
    exit: () => undefined,
    schedule: tools.scheduler.schedule,
    now: tools.scheduler.now,
    log: () => undefined,
  });
  tools.deps.notify = (text) => session.notify(text);
  const emit = (message: VapiMessage) => listener!.onMessage(message);
  const userSays = (transcript: string) => emit({ type: 'transcript', role: 'user', transcriptType: 'final', transcript });
  const toolCall = async (name: string, args: Record<string, unknown> = {}) => {
    emit({ type: 'tool-calls', toolCallList: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  };
  const playsReadBack = () => {
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'assistant.speechStarted', source: 'force-say', text: '' });
    emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: raw.say.mock.calls.at(-1)?.[0] as string });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
  };
  const muted = () => raw.muteCustomer.mock.calls.at(-1)?.[0];
  const saying = (words: string) => {
    const hold = ptt.talk()!;
    hold.start();
    userSays(words);
    hold.end(false);
  };
  return { ...tools, raw, ptt, listening, storage, session, cues, logs, emit, userSays, toolCall, playsReadBack, muted, saying };
}

const draftIdOf = (call: jest.Mock) => (call.mock.calls.map(([content]) => content as string).find((content) => content.includes('draftId=')) ?? '').match(/draftId="([^"]+)"/)?.[1];

const context = { account: 'Signed in as @me.bsky.social.', settings: 'Full posts.', memories: 'Nothing yet.', focus: 'None', memoryOffer: null, photo: null };

async function confirmed(w: ReturnType<typeof world>) {
  await w.session.start();
  w.saying('post hello from my new app');
  await w.toolCall('draft_post', { text: 'Hello from my new app.' });
  w.playsReadBack();
  await w.scheduler.advance(RELEASE_TAIL_MS);
  expect(w.muted()).toBe(true);
  w.saying('post it');
  await w.toolCall('publish_draft', { draftId: draftIdOf(w.raw.addMessage) });
  expect(w.raw.say).toHaveBeenLastCalledWith('Posting in five seconds. Say undo to stop it.', true);
  w.emit({ type: 'speech-update', role: 'assistant', status: 'started' });
  w.emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
}

describe('push to talk', () => {
  it('is the default, and a saved choice of hands-free is kept after a relaunch', async () => {
    const storage = createMemoryStore();
    const fresh = new ListeningModeStore(storage);
    await fresh.load();
    expect(fresh.get()).toBe('pushToTalk');
    fresh.set('handsFree');
    const relaunched = new ListeningModeStore(storage);
    expect(relaunched.get()).toBe('pushToTalk');
    await relaunched.load();
    expect(relaunched.get()).toBe('handsFree');
  });

  it('in hands-free changes nothing: no muting, no hold, the same assistant as before', async () => {
    const w = world('handsFree');
    await w.session.start();
    w.emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    w.userSays('hello');
    await w.scheduler.advance(2000);
    expect(w.ptt.talk()).toBeUndefined();
    expect(w.raw.muteCustomer).not.toHaveBeenCalled();
    expect(w.raw.muteAssistant).not.toHaveBeenCalled();
    expect(w.cues).toEqual([]);
    expect(w.logs).toEqual([]);

    const usual = buildAssistant(context);
    expect(buildAssistant(context, false)).toEqual(usual);
    expect(usual.firstMessage).toBe(FIRST_MESSAGE);
    expect(usual.silenceTimeoutSeconds).toBe(SILENCE_TIMEOUT_SECONDS);
    expect(usual.messagePlan?.idleTimeoutSeconds).toBe(17);
  });

  it('stops the agent hearing once the call is live, lets it hear while a finger is held, and a moment after release', async () => {
    const w = world('pushToTalk');
    expect(w.ptt.talk()).toBeUndefined();
    await w.session.start();
    expect(w.raw.muteCustomer.mock.calls).toEqual([[true]]);
    const hold = w.ptt.talk()!;
    hold.start();
    expect(w.muted()).toBe(false);
    expect(w.cues).toEqual([true]);
    w.userSays('next post');
    hold.end(false);
    expect(w.cues).toEqual([true, false]);
    expect(w.muted()).toBe(false);
    await w.scheduler.advance(RELEASE_TAIL_MS);
    expect(w.muted()).toBe(true);
    expect(w.logs).toEqual([
      'mic {"muted":true,"reason":"call live"}',
      'mic {"muted":false,"reason":"hold"}',
      'talk start {"agentSpeaking":false}',
      'heard {"chars":9,"held":true,"sinceOpenMs":0}',
      'talk end {"heldMs":0,"cancelled":false}',
      'mic {"muted":true,"reason":"release"}',
    ]);
  });

  it('says how to be heard in its first words, and waits five minutes of quiet before ending, with the same maximum length', () => {
    const usual = buildAssistant(context);
    const ptt = buildAssistant(context, true);
    expect(ptt.firstMessage).toBe(`${FIRST_MESSAGE} ${HOLD_TO_TALK}`);
    expect(ptt.silenceTimeoutSeconds).toBe(PUSH_TO_TALK_SILENCE_SECONDS);
    // Vapi answers 400 to an idle prompt later than 60 s, so push to talk has none; hands-free stays within the limit.
    expect(ptt.messagePlan).toBeUndefined();
    expect(usual.messagePlan!.idleTimeoutSeconds).toBeLessThanOrEqual(VAPI_MAX_IDLE_SECONDS);
    expect(ptt.maxDurationSeconds).toBe(usual.maxDurationSeconds);
    expect({ ...ptt, firstMessage: '', silenceTimeoutSeconds: 0, messagePlan: null }).toEqual({ ...usual, firstMessage: '', silenceTimeoutSeconds: 0, messagePlan: null });
  });

  it('after a release keeps listening until Vapi says the user stopped, so the model still answers', async () => {
    const w = world('pushToTalk');
    await w.session.start();
    const hold = w.ptt.talk()!;
    hold.start();
    w.userSays('next post');
    hold.end(false);
    await w.scheduler.advance(RELEASE_TAIL_MS - 100);
    expect(w.muted()).toBe(false);
    w.emit({ type: 'speech-update', role: 'user', status: 'stopped' });
    expect(w.muted()).toBe(true);
    expect(w.logs.at(-1)).toBe('mic {"muted":true,"reason":"user stopped"}');
  });

  it('silences the agent when the finger goes down while it is speaking, and gives its voice back once the user is heard', async () => {
    const w = world('pushToTalk');
    await w.session.start();
    w.emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    w.ptt.talk()!.start();
    expect(w.raw.muteAssistant).toHaveBeenLastCalledWith(true);
    w.userSays('next post');
    expect(w.raw.muteAssistant).toHaveBeenLastCalledWith(false);
  });

  it('needs a hold to answer the read-back, then keeps listening from the yes through the five seconds, so "undo" needs no hold', async () => {
    const w = world('pushToTalk');
    await confirmed(w);
    await w.scheduler.advance(OPEN_POLL_MS);
    expect(w.muted()).toBe(false);
    expect(w.logs.filter((line) => line.startsWith('mic')).slice(-2)).toEqual(['mic {"muted":true,"reason":"release"}', 'mic {"muted":false,"reason":"hold"}']);
    w.userSays('undo');
    expect(w.raw.say).toHaveBeenLastCalledWith('Stopped. Nothing was sent.', true);
    await w.scheduler.advance(20_000);
    expect(w.provider.createPost).not.toHaveBeenCalled();
    expect(w.muted()).toBe(true);
  });

  it('keeps the draft in play (so a swipe down does nothing) while the microphone is open for the five seconds', async () => {
    const w = world('pushToTalk');
    await confirmed(w);
    await w.scheduler.advance(OPEN_POLL_MS);
    expect(w.muted()).toBe(false);
    expect(w.session.draftInPlay).toBe(true);
    w.userSays('undo');
    await w.scheduler.advance(OPEN_POLL_MS);
    expect(w.session.draftInPlay).toBe(false);
    expect(w.muted()).toBe(true);
  });

  it('lets stray speech during the five seconds only hold the send, never publish', async () => {
    const w = world('pushToTalk');
    await confirmed(w);
    await w.scheduler.advance(OPEN_POLL_MS);
    w.userSays('what was that noise');
    await w.scheduler.advance(20_000);
    expect(w.provider.createPost).not.toHaveBeenCalled();
    expect(w.muted()).toBe(true);
  });

  it('still sends after the five seconds when nobody speaks, and closes the microphone again', async () => {
    const w = world('pushToTalk');
    await confirmed(w);
    await w.scheduler.advance(20_000);
    expect(w.provider.createPost).toHaveBeenCalledTimes(1);
    await w.scheduler.advance(OPEN_POLL_MS);
    expect(w.muted()).toBe(true);
  });

  it('switches by voice, says how each mode works, applies it at once, and keeps the choice', async () => {
    const w = world('pushToTalk');
    await w.session.start();
    w.saying('go hands-free');
    await w.toolCall('use_hands_free');
    expect(w.listening.get()).toBe('handsFree');
    expect(w.raw.say).toHaveBeenLastCalledWith(agentMessages.handsFreeOn, expect.anything());
    await w.scheduler.advance(RELEASE_TAIL_MS);
    expect(w.muted()).toBe(false);
    const relaunched = new ListeningModeStore(w.storage);
    await relaunched.load();
    expect(relaunched.get()).toBe('handsFree');

    await w.toolCall('use_push_to_talk');
    expect(w.listening.get()).toBe('pushToTalk');
    expect(w.raw.say).toHaveBeenLastCalledWith(agentMessages.pushToTalkOn, expect.anything());
    expect(w.muted()).toBe(true);
  });
});

describe('the holds on the agent screen', () => {
  function tracker(holdMs?: number) {
    const timers: { at: number; run: () => void }[] = [];
    let clock = 0;
    const talk = { start: jest.fn(), end: jest.fn() };
    const onLike = jest.fn();
    const press = new PressTracker(
      { talk: () => talk, onLike, claim: () => undefined, talkHoldMs: () => holdMs },
      (run, ms) => {
        const timer = { at: clock + ms, run };
        timers.push(timer);
        return () => void timers.splice(timers.indexOf(timer), 1);
      },
      () => clock,
    );
    const advance = (ms: number) => {
      clock += ms;
      timers
        .filter((timer) => timer.at <= clock)
        .forEach((timer) => {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        });
    };
    return { press, talk, onLike, advance };
  }

  it('starts talking only for one finger held still: never for a tap or a stroke', () => {
    const tap = tracker();
    tap.press.down([{ id: 1, x: 100, y: 100 }]);
    tap.advance(PRESS.tapMaxMs - 100);
    tap.press.up([{ id: 1, x: 100, y: 100 }]);
    tap.advance(2000);
    expect(tap.talk.start).not.toHaveBeenCalled();

    const stroke = tracker();
    stroke.press.down([{ id: 1, x: 100, y: 100 }]);
    stroke.advance(200);
    stroke.press.move([{ id: 1, x: 160, y: 100 }]);
    stroke.advance(2000);
    stroke.press.up([{ id: 1, x: 200, y: 100 }]);
    expect(stroke.talk.start).not.toHaveBeenCalled();

    const held = tracker();
    held.press.down([{ id: 1, x: 100, y: 100 }]);
    held.advance(PRESS.talkHoldMs);
    expect(held.talk.start).toHaveBeenCalledTimes(1);
    held.press.up([{ id: 1, x: 100, y: 100 }]);
    expect(held.talk.end).toHaveBeenCalledWith(false);
  });

  it('keeps the two-finger like apart from the talk hold', () => {
    const like = tracker();
    like.press.down([{ id: 1, x: 100, y: 100 }]);
    like.advance(100);
    like.press.down([{ id: 2, x: 200, y: 100 }]);
    like.advance(PRESS.holdMs);
    expect(like.onLike).toHaveBeenCalledTimes(1);
    expect(like.talk.start).not.toHaveBeenCalled();

    const talking = tracker();
    talking.press.down([{ id: 1, x: 100, y: 100 }]);
    talking.advance(PRESS.talkHoldMs);
    talking.press.down([{ id: 2, x: 200, y: 100 }]);
    talking.advance(PRESS.holdMs * 2);
    expect(talking.talk.start).toHaveBeenCalledTimes(1);
    expect(talking.onLike).not.toHaveBeenCalled();
  });
});

describe('push to talk wrapper in hands-free', () => {
  it('hands every message on unchanged and never touches what the agent hears or says', async () => {
    const listening = new ListeningModeStore(createMemoryStore());
    listening.set('handsFree');
    let inner: CallListener | null = null;
    const raw = { start: jest.fn((_a: object, next: CallListener) => ((inner = next), Promise.resolve())), stop: jest.fn(), say: jest.fn(), addMessage: jest.fn(), muteCustomer: jest.fn(), muteAssistant: jest.fn() };
    const log = jest.fn();
    const ptt = withPushToTalk(raw, listening, { cue: jest.fn(), openWhile: () => true, schedule: (run, ms) => ((t) => () => clearTimeout(t))(setTimeout(run, ms)), now: Date.now, log });
    const seen: VapiMessage[] = [];
    const outer = { onMessage: (message: VapiMessage) => seen.push(message), onEnd: jest.fn(), onError: jest.fn() };
    await ptt.call.start({ name: 'test' }, outer);
    const messages: VapiMessage[] = [
      { type: 'speech-update', role: 'assistant', status: 'started' },
      { type: 'transcript', role: 'user', transcriptType: 'final', transcript: 'post it' },
      { type: 'tool-calls', toolCallList: [] },
    ];
    messages.forEach((message) => inner!.onMessage(message));
    inner!.onEnd();
    expect(seen).toEqual(messages);
    seen.forEach((message, i) => expect(message).toBe(messages[i]));
    expect(outer.onEnd).toHaveBeenCalled();
    ptt.call.say('hi', true);
    ptt.call.addMessage('note', false);
    ptt.call.stop();
    ptt.dispose();
    expect(raw.say).toHaveBeenCalledWith('hi', true);
    expect(raw.addMessage).toHaveBeenCalledWith('note', false);
    expect(raw.stop).toHaveBeenCalled();
    expect(raw.muteCustomer).not.toHaveBeenCalled();
    expect(raw.muteAssistant).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('the shorter push-to-talk hold', () => {
  it('starts listening after 0.4 s of a still finger, while a stroke and a quick tap still never do', () => {
    const run = (steps: (press: PressTracker, advance: (ms: number) => void) => void) => {
      let clock = 0;
      const timers: { at: number; run: () => void }[] = [];
      const talk = { start: jest.fn(), end: jest.fn() };
      const press = new PressTracker(
        { talk: () => talk, claim: () => undefined, talkHoldMs: () => 400 },
        (fn, ms) => {
          const timer = { at: clock + ms, run: fn };
          timers.push(timer);
          return () => void timers.splice(timers.indexOf(timer), 1);
        },
        () => clock,
      );
      const advance = (ms: number) => {
        clock += ms;
        timers.filter((timer) => timer.at <= clock).forEach((timer) => {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        });
      };
      steps(press, advance);
      return talk.start.mock.calls.length;
    };
    expect(run((press, advance) => { press.down([{ id: 1, x: 0, y: 0 }]); advance(399); })).toBe(0);
    expect(run((press, advance) => { press.down([{ id: 1, x: 0, y: 0 }]); advance(400); })).toBe(1);
    expect(run((press, advance) => { press.down([{ id: 1, x: 0, y: 0 }]); advance(250); press.up([{ id: 1, x: 0, y: 0 }]); advance(1000); })).toBe(0);
    expect(run((press, advance) => { press.down([{ id: 1, x: 0, y: 0 }]); advance(150); press.move([{ id: 1, x: 40, y: 0 }]); advance(1000); })).toBe(0);
  });
});
