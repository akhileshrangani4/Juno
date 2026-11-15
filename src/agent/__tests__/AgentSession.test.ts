import { maya, nextPost, setup as setupTools } from '@/testing/agent';

import { agentMessages } from '../agentMessages';
import { AgentSession, CONNECT_TIMEOUT_MS, type EndReason } from '../AgentSession';
import { UNDO_WINDOW_MS } from '../publisher';
import type { CallListener, VapiMessage, VoiceCall } from '../voiceCall';

function fakeCall(connect: 'ok' | 'fail' | 'hang' = 'ok') {
  let listener: CallListener | null = null;
  const call = {
    start: jest.fn((_assistant: object, next: CallListener) => {
      listener = next;
      if (connect === 'ok') return Promise.resolve();
      if (connect === 'fail') return Promise.reject(new Error('offline'));
      return new Promise<void>(() => undefined);
    }),
    stop: jest.fn(),
    say: jest.fn(),
    addMessage: jest.fn(),
  } satisfies VoiceCall;
  return { call, emit: (message: VapiMessage) => listener!.onMessage(message), drop: () => listener!.onEnd() };
}

function setup(options: { connect?: 'ok' | 'fail' | 'hang'; microphone?: 'granted' | 'denied'; noCall?: boolean } = {}) {
  const tools = setupTools();
  const { call, emit, drop } = fakeCall(options.connect);
  const exits: { reason: EndReason; message: string }[] = [];
  const cues: string[] = [];
  const statuses: string[] = [];
  const session = new AgentSession({
    call: options.noCall ? null : call,
    handlers: tools.handlers,
    conversation: tools.conversation,
    microphone: async () => options.microphone ?? 'granted',
    assistant: async () => ({ name: 'test' }),
    status: (status) => statuses.push(status),
    connecting: () => cues.push('connecting'),
    listening: () => cues.push('listening'),
    exit: (reason, message) => exits.push({ reason, message }),
    schedule: tools.scheduler.schedule,
    log: () => undefined,
  });
  tools.deps.notify = (text) => session.notify(text);
  const userSays = (transcript: string) => emit({ type: 'transcript', role: 'user', transcriptType: 'final', transcript });
  const toolCall = async (name: string, args: Record<string, unknown> = {}) => {
    emit({ type: 'tool-calls', toolCallList: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  };
  return { ...tools, session, call, emit, drop, exits, cues, statuses, userSays, toolCall };
}

const draftIdOf = (call: jest.Mock) => (call.mock.calls.map(([content]) => content as string).find((content) => content.includes('draftId=')) ?? '').match(/draftId="([^"]+)"/)?.[1];

describe('AgentSession', () => {
  it('connects, cues connecting then listening, and ends with the asleep message when the user leaves', async () => {
    const { session, call, cues, statuses, exits } = setup();
    await session.start();
    expect(call.start).toHaveBeenCalledWith({ name: 'test' }, expect.any(Object));
    expect(cues).toEqual(['connecting', 'listening']);
    expect(statuses).toEqual(['starting', 'connecting', 'listening']);
    session.stop();
    expect(call.stop).toHaveBeenCalled();
    expect(exits).toEqual([{ reason: 'user', message: agentMessages.asleep }]);
    session.stop();
    expect(exits).toHaveLength(1);
  });

  it('says it could not connect and goes back to scrolling', async () => {
    const { session, exits, cues } = setup({ connect: 'fail' });
    await session.start();
    expect(cues).toEqual(['connecting']);
    expect(exits).toEqual([{ reason: 'failed', message: "I couldn't connect. Check your internet and try again." }]);
  });

  it('gives up connecting after the timeout', async () => {
    const { session, exits, scheduler } = setup({ connect: 'hang' });
    const started = session.start();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await scheduler.advance(CONNECT_TIMEOUT_MS);
    await started;
    expect(exits.map((exit) => exit.reason)).toEqual(['failed']);
  });

  it('explains a denied microphone and never starts a call', async () => {
    const { session, call, exits } = setup({ microphone: 'denied' });
    await session.start();
    expect(call.start).not.toHaveBeenCalled();
    expect(exits[0].reason).toBe('micDenied');
    expect(exits[0].message).toMatch(/open the Settings app, scroll to Juno.*turn on Microphone/);
  });

  it('says the agent is not set up when there is no Vapi key', async () => {
    const { session, exits } = setup({ noCall: true });
    await session.start();
    expect(exits[0].reason).toBe('notConfigured');
  });

  it('runs tool calls on the phone and sends the result back to the model', async () => {
    const { session, call, toolCall } = setup();
    await session.start();
    await toolCall('read_post', { mode: 'brief' });
    expect(call.say).toHaveBeenCalledWith('Maya, 2 hours ago. Meet our new puppy Biscuit! It has an image.');
    expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of read_post: READ_ALOUD/), false);
    await toolCall('like_post');
    expect(call.addMessage).toHaveBeenLastCalledWith("Result of like_post: LIKED: Liked Maya's post. Confirm in a word or two.", true);
  });

  it('tells the model when focus changes, once per post', async () => {
    const { session, call } = setup();
    session.focusChanged(maya);
    await session.start();
    session.focusChanged(maya);
    expect(call.addMessage).not.toHaveBeenCalled();
    session.focusChanged(nextPost);
    expect(call.addMessage).toHaveBeenCalledWith(expect.stringMatching(/^Focus changed\. The post in focus is now: Author: Alice Chen/), false);
  });

  it('starts the five seconds after the notice is spoken and cancels on a heard undo', async () => {
    const { session, call, userSays, toolCall, emit, scheduler, provider } = setup();
    await session.start();
    userSays('post hello from my new app');
    await toolCall('draft_post', { text: 'Hello from my new app.' });
    userSays('yes');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    expect(call.say).toHaveBeenLastCalledWith('Posting in five seconds. Say undo to stop it.');
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await scheduler.advance(3000);
    userSays('undo!');
    expect(call.say).toHaveBeenLastCalledWith('Stopped. Nothing was sent.');
    await scheduler.advance(20_000);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it('sends after five seconds and tells the model it was sent', async () => {
    const { session, call, userSays, toolCall, emit, scheduler, provider } = setup();
    await session.start();
    userSays('post hello from my new app');
    await toolCall('draft_post', { text: 'Hello from my new app.' });
    userSays('Yes please.');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledWith({ text: 'Hello from my new app.' });
    expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of publish_draft: SENT\. The post was published/), true);
  });

  it('cancels a post still in its five seconds when the agent goes to sleep', async () => {
    const { session, call, userSays, toolCall, scheduler, provider, exits } = setup();
    await session.start();
    userSays('post hello');
    await toolCall('draft_post', { text: 'Hello' });
    userSays('yes');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    session.stop();
    await scheduler.advance(30_000);
    expect(provider.createPost).not.toHaveBeenCalled();
    expect(exits[0].message).toBe(`Your post was not sent. ${agentMessages.asleep}`);
  });

  it('ends with a spoken notice after silence or the time limit, and when the agent ends the call', async () => {
    for (const [endedReason, reason, message] of [
      ['silence-timed-out', 'silence', agentMessages.silence],
      ['exceeded-max-duration', 'maxDuration', agentMessages.maxDuration],
      ['pipeline-error', 'dropped', agentMessages.dropped],
    ] as const) {
      const { session, emit, exits } = setup();
      await session.start();
      emit({ type: 'status-update', status: 'ended', endedReason });
      expect(exits).toEqual([{ reason, message }]);
    }
    const { session, toolCall, call, exits } = setup();
    await session.start();
    await toolCall('end_conversation');
    expect(call.stop).toHaveBeenCalled();
    expect(exits).toEqual([{ reason: 'agent', message: agentMessages.asleep }]);
  });

  it('opens sign-in by ending the call first', async () => {
    const { session, toolCall, call, exits } = setup();
    await session.start();
    await toolCall('open_sign_in');
    expect(call.stop).toHaveBeenCalled();
    expect(exits).toEqual([{ reason: 'signIn', message: agentMessages.signIn }]);
  });

  it('treats a dropped connection as the end of the call', async () => {
    const { session, drop, exits } = setup();
    await session.start();
    drop();
    expect(exits.map((exit) => exit.reason)).toEqual(['dropped']);
  });
});
