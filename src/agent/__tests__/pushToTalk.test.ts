import { setup as setupTools } from '@/testing/agent';
import { createMemoryStore } from '@/storage/keyValueStore';
import { PRESS, PressTracker } from '@/gestures/press';

import { agentMessages } from '../agentMessages';
import { AgentSession } from '../AgentSession';
import { buildAssistant, PUSH_TO_TALK_IDLE_SECONDS, PUSH_TO_TALK_SILENCE_SECONDS, SILENCE_TIMEOUT_SECONDS } from '../assistant';
import { ListeningModeStore, withPushToTalk, type ListeningMode } from '../listeningMode';
import type { CallListener, VapiMessage } from '../voiceCall';

function world(mode: ListeningMode) {
  const tools = setupTools({ readBacksHeard: false });
  const storage = createMemoryStore();
  const listening = new ListeningModeStore(storage);
  if (mode === 'pushToTalk') listening.set('pushToTalk');
  let listener: CallListener | null = null;
  const received: VapiMessage[] = [];
  const raw = {
    start: jest.fn((_assistant: object, next: CallListener) => {
      listener = next;
      return Promise.resolve();
    }),
    stop: jest.fn(),
    say: jest.fn(),
    addMessage: jest.fn(),
    setMuted: jest.fn(),
    muteAssistant: jest.fn(),
  };
  const cues: string[] = [];
  const ptt = withPushToTalk(raw, listening, { pressed: () => cues.push('pressed'), released: () => cues.push('released') });
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
  const emit = (message: VapiMessage) => {
    received.push(message);
    listener!.onMessage(message);
  };
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
  return { ...tools, raw, ptt, listening, storage, session, cues, emit, userSays, toolCall, playsReadBack };
}

const draftIdOf = (call: jest.Mock) => (call.mock.calls.map(([content]) => content as string).find((content) => content.includes('draftId=')) ?? '').match(/draftId="([^"]+)"/)?.[1];

const context = { account: 'Signed in as @me.bsky.social.', settings: 'Full posts.', memories: 'Nothing yet.', focus: 'None', memoryOffer: null, photo: null };

describe('push to talk', () => {
  it('in hands-free changes nothing: no muting, no hold, the same messages and the same assistant as before', async () => {
    const w = world('handsFree');
    await w.session.start();
    expect(w.raw.setMuted).not.toHaveBeenCalled();
    expect(w.ptt.talk()).toBeUndefined();
    w.emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    w.userSays('hello');
    expect(w.raw.muteAssistant).not.toHaveBeenCalled();
    expect(w.cues).toEqual([]);
    expect(w.raw.start).toHaveBeenCalledWith({ name: 'test' }, expect.any(Object));

    const usual = buildAssistant(context);
    expect(buildAssistant(context, false)).toEqual(usual);
    expect(usual.silenceTimeoutSeconds).toBe(SILENCE_TIMEOUT_SECONDS);
    expect(usual.messagePlan.idleTimeoutSeconds).toBe(17);
    expect(usual.model.tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['use_push_to_talk', 'use_hands_free']));
  });

  it('mutes the microphone once the call is live, unmutes it while a finger is held, and mutes it again on release', async () => {
    const w = world('pushToTalk');
    expect(w.ptt.talk()).toBeUndefined();
    await w.session.start();
    expect(w.raw.setMuted.mock.calls).toEqual([[true]]);
    const hold = w.ptt.talk()!;
    hold.start();
    expect(w.raw.setMuted).toHaveBeenLastCalledWith(false);
    expect(w.cues).toEqual(['pressed']);
    hold.end(false);
    expect(w.raw.setMuted).toHaveBeenLastCalledWith(true);
    expect(w.cues).toEqual(['pressed', 'released']);
    expect(w.raw.muteAssistant).not.toHaveBeenCalled();
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

  it('gives a muted call five minutes of quiet before it ends, with the same maximum length', () => {
    const usual = buildAssistant(context);
    const ptt = buildAssistant(context, true);
    expect(ptt.silenceTimeoutSeconds).toBe(PUSH_TO_TALK_SILENCE_SECONDS);
    expect(PUSH_TO_TALK_SILENCE_SECONDS).toBeGreaterThanOrEqual(180);
    expect(ptt.messagePlan.idleTimeoutSeconds).toBe(PUSH_TO_TALK_IDLE_SECONDS);
    expect(ptt.maxDurationSeconds).toBe(usual.maxDurationSeconds);
    expect({ ...ptt, silenceTimeoutSeconds: 0, messagePlan: null }).toEqual({ ...usual, silenceTimeoutSeconds: 0, messagePlan: null });
  });

  it('switches by voice, says how each mode works, mutes or unmutes at once, and keeps the choice after a relaunch', async () => {
    const w = world('handsFree');
    await w.session.start();
    await w.toolCall('use_push_to_talk');
    expect(w.listening.get()).toBe('pushToTalk');
    expect(w.raw.say).toHaveBeenLastCalledWith(agentMessages.pushToTalkOn, expect.anything());
    expect(w.raw.setMuted).toHaveBeenLastCalledWith(true);
    const relaunched = new ListeningModeStore(w.storage);
    await relaunched.load();
    expect(relaunched.get()).toBe('pushToTalk');

    await w.toolCall('use_hands_free');
    expect(w.listening.get()).toBe('handsFree');
    expect(w.raw.say).toHaveBeenLastCalledWith(agentMessages.handsFreeOn, expect.anything());
    expect(w.raw.setMuted).toHaveBeenLastCalledWith(false);
    const again = new ListeningModeStore(w.storage);
    await again.load();
    expect(again.get()).toBe('handsFree');
  });

  it('stops the send when "undo" is said while holding during the five seconds', async () => {
    const w = world('pushToTalk');
    await w.session.start();
    const hold = () => w.ptt.talk()!;
    let held = hold();
    held.start();
    w.userSays('post hello from my new app');
    held.end(false);
    await w.toolCall('draft_post', { text: 'Hello from my new app.' });
    w.playsReadBack();
    held = hold();
    held.start();
    w.userSays('post it');
    held.end(false);
    await w.toolCall('publish_draft', { draftId: draftIdOf(w.raw.addMessage) });
    expect(w.raw.say).toHaveBeenLastCalledWith('Posting in five seconds. Say undo to stop it.', true);
    w.emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    w.emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await w.scheduler.advance(2000);
    held = hold();
    held.start();
    w.userSays('undo');
    held.end(false);
    expect(w.raw.say).toHaveBeenLastCalledWith('Stopped. Nothing was sent.', true);
    await w.scheduler.advance(20_000);
    expect(w.provider.createPost).not.toHaveBeenCalled();
  });
});

describe('the hold that unmutes', () => {
  function tracker() {
    const timers: { at: number; run: () => void }[] = [];
    let clock = 0;
    const talk = { start: jest.fn(), end: jest.fn() };
    const press = new PressTracker(
      { talk: () => talk, claim: () => undefined },
      (run, ms) => {
        const timer = { at: clock + ms, run };
        timers.push(timer);
        return () => timers.splice(timers.indexOf(timer), 1);
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
    return { press, talk, advance };
  }

  it('is never started by a tap or a stroke, only by a finger held still', () => {
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
});

describe('push to talk wrapper in hands-free', () => {
  it('hands every message on unchanged and never touches the microphone or the agent voice', async () => {
    const listening = new ListeningModeStore(createMemoryStore());
    let inner: CallListener | null = null;
    const raw = { start: jest.fn((_a: object, next: CallListener) => ((inner = next), Promise.resolve())), stop: jest.fn(), say: jest.fn(), addMessage: jest.fn(), setMuted: jest.fn(), muteAssistant: jest.fn() };
    const ptt = withPushToTalk(raw, listening, { pressed: jest.fn(), released: jest.fn() });
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
    expect(raw.say).toHaveBeenCalledWith('hi', true);
    expect(raw.addMessage).toHaveBeenCalledWith('note', false);
    expect(raw.stop).toHaveBeenCalled();
    expect(raw.setMuted).not.toHaveBeenCalled();
    expect(raw.muteAssistant).not.toHaveBeenCalled();
  });
});

