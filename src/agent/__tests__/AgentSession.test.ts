import { maya, nextPost, setup as setupTools } from '@/testing/agent';

import { agentMessages } from '../agentMessages';
import { AgentSession, CONNECT_TIMEOUT_MS, COUNTDOWN_FALLBACK_MS, type EndReason } from '../AgentSession';
import { UNDO_WINDOW_MS } from '../publisher';
import { TRANSCRIPT_WAIT_MS } from '../toolHandlers';
import { vapiTools } from '../tools';
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
  const tools = setupTools({ readBacksHeard: false });
  const { call, emit, drop } = fakeCall(options.connect);
  const exits: { reason: EndReason; message: string }[] = [];
  const cues: string[] = [];
  const statuses: string[] = [];
  const logs: string[] = [];
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
    now: tools.scheduler.now,
    log: (event, detail) => logs.push(detail ? `${event} ${JSON.stringify(detail)}` : event),
  });
  tools.deps.notify = (text) => session.notify(text);
  const userSays = (transcript: string) => emit({ type: 'transcript', role: 'user', transcriptType: 'final', transcript });
  const toolCall = async (name: string, args: Record<string, unknown> = {}) => {
    emit({ type: 'tool-calls', toolCallList: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  };
  // The app's last say() played to the end, as Vapi reports it.
  const playsReadBack = () => {
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'assistant.speechStarted', source: 'force-say', text: '' });
    emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: call.say.mock.calls.at(-1)?.[0] as string });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
  };
  return { ...tools, session, call, emit, drop, exits, cues, statuses, logs, userSays, toolCall, playsReadBack };
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

  it('stops the call once and forgets the connect timeout when the user leaves while it connects', async () => {
    const { session, call, exits, scheduler, logs } = setup({ connect: 'hang' });
    const started = session.start();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(scheduler.pending()).toBe(1);
    session.stop();
    await started;
    expect(scheduler.pending()).toBe(0);
    await scheduler.advance(CONNECT_TIMEOUT_MS);
    expect(call.stop).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([{ reason: 'user', message: agentMessages.asleep }]);
    expect(logs.some((line) => line.startsWith('connect failed'))).toBe(false);
  });

  it('reports a draft in play from its read-back through the countdown, and reading it changes nothing', async () => {
    const { session, handlers, userSays, toolCall, playsReadBack } = setup();
    await session.start();
    expect(session.draftInPlay).toBe(false);
    userSays('Post, hello there.');
    await toolCall('draft_post', { text: 'Hello there.' });
    const draft = handlers.publisher.currentDraft;
    expect(session.draftInPlay).toBe(true);
    expect(handlers.publisher.currentDraft).toBe(draft);
    playsReadBack();
    userSays('Post it.');
    expect(handlers.publisher.busy).toBe(true);
    expect(session.draftInPlay).toBe(true);
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
    expect(call.say).toHaveBeenCalledWith('Maya. Meet our new puppy Biscuit! Has an image and two hashtags. 2 replies.', true);
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
    const { session, call, userSays, toolCall, emit, scheduler, provider, playsReadBack } = setup();
    await session.start();
    userSays('post hello from my new app');
    await toolCall('draft_post', { text: 'Hello from my new app.' });
    playsReadBack();
    userSays('yes');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    expect(call.say).toHaveBeenLastCalledWith('Posting in five seconds. Say undo to stop it.', true);
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await scheduler.advance(3000);
    userSays('undo!');
    expect(call.say).toHaveBeenLastCalledWith('Stopped. Nothing was sent.', true);
    await scheduler.advance(20_000);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  describe("telling the app's read-back apart from the model's speech", () => {
    const readBack = 'Posting to your followers: @alice.bsky.social see you at 5. Shall I post it?';
    const asSpoken = 'Posting to your followers. alice dot bsky dot social see you at five. Shall I post it?';
    const question = 'Want me to like it too?';
    const countdown = 'Posting in five seconds. Say undo to stop it.';
    const sayPostIt = 'Say "post it" to send it, or "cancel".';
    const readBackAgain = readBack.replace('Shall I post it?', sayPostIt);

    async function drafted(tool: 'draft_post' | 'draft_reply' = 'draft_post', text = '@alice.bsky.social see you at 5') {
      const world = setup();
      await world.session.start();
      world.userSays(`${tool === 'draft_post' ? 'post' : 'reply'} ${text}`);
      await world.toolCall(tool, { text });
      const assistantSays = (transcript: string) => world.emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript });
      const speech = (turn?: number) => world.emit({ type: 'speech-update', role: 'assistant', status: 'started', turn });
      const source = (value: unknown, turn: number) => world.emit({ type: 'assistant.speechStarted', source: value, turn, text: '' });
      const confirm = async () => {
        world.userSays('yes');
        await world.toolCall('publish_draft', { draftId: draftIdOf(world.call.addMessage) });
      };
      const lastSaid = () => world.call.say.mock.calls.at(-1)?.[0] as string;
      return { ...world, assistantSays, speech, source, confirm, lastSaid, spokenReadBack: lastSaid() };
    }

    it('keeps the yes when the read-back comes back with digits spelled out and the handle reformatted', async () => {
      const { speech, assistantSays, confirm, lastSaid, logs } = await drafted();
      speech(1);
      assistantSays(asSpoken);
      await confirm();
      expect(lastSaid()).toBe(countdown);
      expect(logs).toContain('assistant speech during read-back {"speaker":"app","by":"timing and words","source":null,"turn":1}');
      expect(logs).toContain('publish confirmed {"by":"words"}');
    });

    it("lets Vapi's force-say decide who spoke, but a read-back whose words never came back wasn't heard", async () => {
      const { source, speech, assistantSays, confirm, lastSaid, logs } = await drafted();
      source('force-say', 1);
      speech(1);
      assistantSays('Words the formatter rewrote beyond recognition.');
      await confirm();
      expect(lastSaid()).toBe(readBackAgain);
      expect(logs).toContain('assistant speech during read-back {"speaker":"app","by":"source","source":"force-say","turn":1}');
    });

    it("voids the yes when the model asks its own question after the read-back, and keeps the next read-back's yes", async () => {
      const { speech, assistantSays, confirm, lastSaid, logs, provider, userSays, toolCall, call } = await drafted();
      speech(1);
      assistantSays(asSpoken);
      speech(2);
      assistantSays(question);
      await confirm();
      expect(lastSaid()).toBe(sayPostIt);
      expect(logs).toEqual(
        expect.arrayContaining([
          'assistant speech during read-back {"speaker":"model","by":"timing and words","source":null,"turn":2}',
          'yes voided by assistant speech {"by":"timing and words","source":null,"turn":2}',
          'publish refused {"reason":"expired"}',
        ]),
      );
      userSays('post it');
      await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
      expect(lastSaid()).toBe(countdown);
      expect(provider.createPost).not.toHaveBeenCalled();
    });

    it('treats only force-say as the app: custom-voice and any other named source are the model', async () => {
      for (const named of ['custom-voice', 'something-new']) {
        const { speech, source, assistantSays, confirm, lastSaid } = await drafted();
        speech(1);
        assistantSays(asSpoken);
        source(named, 2);
        assistantSays(question);
        await confirm();
        expect([named, lastSaid()]).toEqual([named, sayPostIt]);
      }
    });

    it('treats a report with no source as no report, so the words still have to be the read-back', async () => {
      const { source, speech, assistantSays, confirm, lastSaid } = await drafted();
      source(undefined, 1);
      speech(1);
      assistantSays(question);
      await confirm();
      expect(lastSaid()).toBe(readBackAgain);
    });

    it("lets Vapi naming the model win over a word match: a question reusing the reply's words doesn't confirm it", async () => {
      const { source, assistantSays, confirm, lastSaid, spokenReadBack, provider } = await drafted('draft_reply', 'I will delete my post tonight');
      expect(spokenReadBack).toMatch(/: I will delete my post tonight\. Shall I send the reply\?$/);
      source('force-say', 1);
      assistantSays(spokenReadBack);
      source('model', 2);
      assistantSays('Shall I delete my post tonight?');
      await confirm();
      expect(lastSaid()).toBe('Say "send it" to send the reply, or "cancel".');
      expect(provider.reply).not.toHaveBeenCalled();
    });

    it("needs the whole read-back, not a sentence made of its words, when Vapi names no source", async () => {
      const { speech, assistantSays, confirm, lastSaid, spokenReadBack } = await drafted('draft_reply', 'I will delete my post tonight');
      speech(1);
      assistantSays('Shall I delete my post tonight?');
      await confirm();
      expect(lastSaid()).toBe(spokenReadBack.replace('Shall I send the reply?', 'Say "send it" to send the reply, or "cancel".'));
    });

    it('starts a new segment when the model is named within the same turn as the read-back', async () => {
      const { source, assistantSays, confirm, lastSaid } = await drafted();
      source('force-say', 1);
      assistantSays(asSpoken);
      source('force-say', 1);
      source('model', 1);
      assistantSays(question);
      await confirm();
      expect(lastSaid()).toBe(sayPostIt);
    });

    it('voids the yes when Vapi names the model, even with a say() still due', async () => {
      const { source, speech, assistantSays, confirm, lastSaid } = await drafted();
      source('model', 1);
      speech(1);
      assistantSays(asSpoken);
      await confirm();
      expect(lastSaid()).toBe(readBackAgain);
    });

    it('puts it down to the model when the signals are missing or disagree', async () => {
      const noEvents = await drafted();
      noEvents.assistantSays(asSpoken);
      await noEvents.confirm();
      expect(noEvents.lastSaid()).toBe(readBackAgain);

      const expired = await drafted();
      await expired.scheduler.advance(60_000);
      expired.speech(1);
      expired.assistantSays(asSpoken);
      await expired.confirm();
      expect(expired.lastSaid()).toBe(readBackAgain);
    });
  });

  // The event sequences of the device log of build 1226095 (handoffs/device-logs/1226095-round7-publish-loop.log),
  // where one call refused seven confirmations and published nothing, and of a real Vapi web call
  // (src/agent/__eval__/liveCall.run.ts). On main before AKH-48 every one of these ends with nothing published.
  describe('replays of the publishing loop (AKH-48)', () => {
    const readBack = 'Posting to your followers: Hello from my new app. Shall I post it?';
    const countdown = 'Posting in five seconds. Say undo to stop it.';

    async function drafted() {
      const world = setup();
      await world.session.start();
      world.userSays('post hello from my new app');
      await world.toolCall('draft_post', { text: 'Hello from my new app.' });
      const id = draftIdOf(world.call.addMessage);
      const segment = (turn: number, source: string | undefined, ...chunks: string[]) => {
        world.emit({ type: 'speech-update', role: 'assistant', status: 'started', turn });
        world.emit({ type: 'assistant.speechStarted', source, turn, text: '' });
        for (const transcript of chunks) world.emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript });
        world.emit({ type: 'speech-update', role: 'assistant', status: 'stopped', turn });
      };
      const answer = async (utterance: string) => {
        world.userSays(utterance);
        await world.toolCall('publish_draft', { draftId: id });
        return world.call.say.mock.calls.at(-1)?.[0] as string;
      };
      return { ...world, id, segment, answer };
    }

    it('interrupts whatever the agent is saying with the read-back, and Vapi never asks the model to answer a tool', async () => {
      const { call } = await drafted();
      expect(call.say).toHaveBeenLastCalledWith(readBack, true);
      for (const tool of vapiTools) expect(tool.messages).toEqual([{ type: 'request-start', content: '' }, { type: 'request-complete', content: '' }]);
    });

    it('turns 1, 2, 6 and 7: a read-back in chunks with no source is the app, and yes publishes', async () => {
      const { segment, answer, logs, scheduler, provider } = await drafted();
      segment(1, undefined, 'Posting to your followers,', 'Hello from my new app. Shall I post it?');
      expect(await answer('Yes.')).toBe(countdown);
      expect(logs).toContain('read-back heard in full {"by":"timing and words","source":null,"turn":1}');
      expect(logs.some((line) => line.startsWith('yes voided'))).toBe(false);
      await scheduler.advance(COUNTDOWN_FALLBACK_MS);
      await scheduler.advance(UNDO_WINDOW_MS);
      expect(provider.createPost).toHaveBeenCalledWith({ text: 'Hello from my new app.' });
    });

    it('turns 4 and 5: the model talks after the read-back, so yes is refused once with what to say, and post it publishes', async () => {
      const { segment, answer, logs } = await drafted();
      segment(4, 'force-say', 'Posting to your followers,', 'Hello from my new app. Shall I post it?');
      segment(4, 'model', 'Your', 'post draft says,', 'hello from my new app.', 'Would you like to post it?');
      expect(logs).toContain('yes voided by assistant speech {"by":"source","source":"model","turn":4}');
      expect(await answer('Yes.')).toBe('Say "post it" to send it, or "cancel".');
      expect(await answer('Post it.')).toBe(countdown);
    });

    it('turn 8: force-say chunks then a model chunk; yes twice never repeats the question, and post it still publishes', async () => {
      const { segment, answer, logs } = await drafted();
      segment(8, 'force-say', 'Posting to your followers,', 'Hello from my new app. Shall I post it?');
      segment(8, 'model', 'Just say yes when you are ready.');
      expect(await answer('yes')).toBe('Say "post it" to send it, or "cancel".');
      expect(await answer('yes')).toBe('I\'ll keep it as a draft and stop asking. Say "post it" whenever you\'re ready, or "cancel".');
      expect(await answer('yes')).toBe('I\'ll keep it as a draft and stop asking. Say "post it" whenever you\'re ready, or "cancel".');
      expect(logs.filter((line) => line === 'publish refused {"reason":"expired"}')).toHaveLength(3);
      expect(await answer('Juno, post it')).toBe(countdown);
    });

    it('a read-back cut off partway is never heard in full, so post it needs it read again', async () => {
      const { segment, answer, call } = await drafted();
      segment(1, undefined, 'Posting to your followers,');
      expect(await answer('post it')).toBe(readBack.replace('Shall I post it?', 'Say "post it" to send it, or "cancel".'));
      expect(call.say).toHaveBeenLastCalledWith(expect.any(String), true);
      segment(2, 'force-say', 'Posting to your followers,', 'Hello from my new app. Say "post it" to send it, or "cancel".');
      expect(await answer('post it')).toBe(countdown);
    });

    it('a stray tool call of the model after a re-read is refused and costs nothing: yes then publishes', async () => {
      const { segment, answer, toolCall, call, provider, logs, scheduler } = await drafted();
      segment(1, 'model', 'Do you want to post it?');
      expect(await answer('yes')).toBe(readBack.replace('Shall I post it?', 'Say "post it" to send it, or "cancel".'));
      segment(2, 'force-say', readBack.replace('Shall I post it?', 'Say "post it" to send it, or "cancel".'));
      await toolCall('like_post');
      await scheduler.advance(TRANSCRIPT_WAIT_MS);
      expect(provider.like).not.toHaveBeenCalled();
      expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of like_post: WAITING_FOR_ANSWER/), false);
      expect(logs).toContain('tool refused {"reason":"awaitingAnswer"}');
      expect(await answer('yes')).toBe(countdown);
    });

    it('a stray tool call and model speech after a re-read: yes is refused, post it publishes', async () => {
      const { segment, answer, toolCall } = await drafted();
      segment(1, undefined, 'Posting to your followers,');
      expect(await answer('yes')).toBe(readBack.replace('Shall I post it?', 'Say "post it" to send it, or "cancel".'));
      segment(2, 'force-say', readBack.replace('Shall I post it?', 'Say "post it" to send it, or "cancel".'));
      await toolCall('like_post');
      segment(3, 'model', 'I liked the post for you.');
      expect(await answer('yes')).toBe('I\'ll keep it as a draft and stop asking. Say "post it" whenever you\'re ready, or "cancel".');
      expect(await answer('post it')).toBe(countdown);
    });

    it("the last refusal (sameTurn): a confirmation Vapi sends before the user's words waits for them", async () => {
      const { segment, toolCall, userSays, id, call } = await drafted();
      segment(1, 'force-say', readBack);
      await toolCall('publish_draft', { draftId: id });
      userSays('yes');
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
      expect(call.say).toHaveBeenLastCalledWith(countdown, true);
    });

    it("okay, let me think is not a yes; the model's own answer to it then makes the next yes need post it", async () => {
      const { segment, answer, call, provider } = await drafted();
      segment(1, 'force-say', readBack);
      call.say.mockClear();
      await answer('okay, let me think');
      expect(call.say).not.toHaveBeenCalled();
      expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of publish_draft: REFUSED: .*not a plain yes/), true);
      segment(2, 'model', 'Take your time. Do you want me to post it?');
      expect(await answer('yes')).toBe('Say "post it" to send it, or "cancel".');
      expect(await answer('post it now')).toBe(countdown);
      expect(provider.createPost).not.toHaveBeenCalled();
    });
  });

  it('holds a send counting down when the second half of a split yes asks for a change', async () => {
    const { session, call, userSays, toolCall, emit, scheduler, provider, playsReadBack } = setup();
    await session.start();
    userSays('post hello from my new app');
    await toolCall('draft_post', { text: 'Hello from my new app.' });
    playsReadBack();
    userSays('Yes.');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await scheduler.advance(1000);
    userSays('But change it to goodbye.');
    expect(call.say).toHaveBeenLastCalledWith('I stopped it, nothing was sent. Posting to your followers: Hello from my new app. Shall I post it?', true);
    expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^HELD draftId=/), false);
    await scheduler.advance(20_000);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it('sends after five seconds and tells the model it was sent', async () => {
    const { session, call, userSays, toolCall, emit, scheduler, provider, playsReadBack } = setup();
    await session.start();
    userSays('post hello from my new app');
    await toolCall('draft_post', { text: 'Hello from my new app.' });
    playsReadBack();
    userSays('Yes please.');
    await toolCall('publish_draft', { draftId: draftIdOf(call.addMessage) });
    emit({ type: 'speech-update', role: 'assistant', status: 'started' });
    emit({ type: 'speech-update', role: 'assistant', status: 'stopped' });
    await scheduler.advance(UNDO_WINDOW_MS);
    expect(provider.createPost).toHaveBeenCalledWith({ text: 'Hello from my new app.' });
    expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Result of publish_draft: SENT\. The post was published/), true);
  });

  it('cancels a post still in its five seconds when the agent goes to sleep', async () => {
    const { session, call, userSays, toolCall, scheduler, provider, exits, playsReadBack } = setup();
    await session.start();
    userSays('post hello');
    await toolCall('draft_post', { text: 'Hello' });
    playsReadBack();
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

  // The four ways the Overseer found to publish what the user didn't knowingly approve (reports/CONS-6-pr21.md),
  // and its should-fix cases. Each fails on ae175f3.
  describe("nothing publishes without the user's knowing yes (Overseer review of #21)", () => {
    async function heardDraft(tool: 'draft_post' | 'draft_reply' | 'draft_repost', text = 'Hello from my new app.') {
      const world = setup();
      await world.session.start();
      world.userSays(tool === 'draft_repost' ? 'repost this' : `${tool === 'draft_post' ? 'post' : 'reply'} ${text}`);
      await world.toolCall(tool, tool === 'draft_repost' ? {} : { text });
      const id = draftIdOf(world.call.addMessage)!;
      world.playsReadBack();
      const lastSaid = () => world.call.say.mock.calls.at(-1)?.[0] as string;
      const sent = () => world.provider.createPost.mock.calls.length + world.provider.reply.mock.calls.length + world.provider.repost.mock.calls.length + world.provider.deletePost.mock.calls.length;
      const settle = async () => {
        await world.scheduler.advance(TRANSCRIPT_WAIT_MS);
        await world.scheduler.advance(COUNTDOWN_FALLBACK_MS);
        await world.scheduler.advance(UNDO_WINDOW_MS);
        await world.scheduler.advance(30_000);
      };
      return { ...world, id, lastSaid, sent, settle };
    }

    describe('B1: a reply or repost is bound to the post it was drafted on', () => {
      it('drops a repost when the agent moves to the next post, so "repost this" there never reposts the old one', async () => {
        const { userSays, toolCall, lastSaid, provider, session, settle, call } = await heardDraft('draft_repost');
        userSays('no, next');
        await toolCall('go_to_post', { direction: 'next' });
        session.focusChanged(nextPost);
        expect(lastSaid()).toMatch(/^I dropped the repost of Maya's post\. Nothing was sent\. /);
        userSays('repost this');
        await toolCall('publish_draft', { draftId: 'd1' });
        await settle();
        expect(provider.repost).not.toHaveBeenCalled();
        expect(call.say.mock.calls.filter(([text]) => /dropped/.test(text as string))).toHaveLength(1);
      });

      it('drops a reply when a swipe moves focus, and says so; "send it" afterwards sends nothing', async () => {
        const { userSays, lastSaid, provider, session, setFocus, settle, call } = await heardDraft('draft_reply', "That's lovely");
        setFocus(nextPost);
        session.focusChanged(nextPost);
        expect(lastSaid()).toBe('I dropped your reply to Maya. Nothing was sent.');
        expect(call.addMessage).toHaveBeenLastCalledWith(expect.stringMatching(/^Focus changed\. The app dropped the pending reply/), false);
        userSays('send it');
        await settle();
        expect(provider.reply).not.toHaveBeenCalled();
      });

      it('drops a reply whose post left focus even before the app hears about the move', async () => {
        const { userSays, lastSaid, provider, setFocus, settle, toolCall, id } = await heardDraft('draft_reply', "That's lovely");
        setFocus(nextPost);
        userSays('share this');
        expect(lastSaid()).toBe('I dropped your reply to Maya. Nothing was sent.');
        await toolCall('publish_draft', { draftId: id });
        await settle();
        expect(provider.reply).not.toHaveBeenCalled();
      });

      it('names who the reply or repost goes to when it starts counting down', async () => {
        const reply = await heardDraft('draft_reply', "That's lovely");
        reply.userSays('send it');
        expect(reply.lastSaid()).toBe('Sending your reply to Maya in five seconds. Say undo to stop it.');
        const repost = await heardDraft('draft_repost');
        repost.userSays('yes');
        expect(repost.lastSaid()).toBe("Reposting Maya's post in five seconds. Say undo to stop it.");
      });

      it('keeps a new post, which has no target, when focus moves, and says it is kept', async () => {
        const { userSays, toolCall, lastSaid, session, settle, provider } = await heardDraft('draft_post');
        userSays('next');
        await toolCall('go_to_post', { direction: 'next' });
        session.focusChanged(nextPost);
        expect(lastSaid()).toMatch(/^Your draft is kept, not sent\. /);
        userSays('post it');
        await settle();
        expect(provider.createPost).toHaveBeenCalledWith({ text: 'Hello from my new app.' });
      });
    });

    describe('B2: nothing is heard or sent once the conversation is over', () => {
      it.each([
        [
          'the agent ends it',
          async (world: Awaited<ReturnType<typeof heardDraft>>) => {
            world.userSays('goodbye');
            await world.toolCall('end_conversation');
          },
        ],
        ['silence', async (world: Awaited<ReturnType<typeof heardDraft>>) => world.emit({ type: 'status-update', status: 'ended', endedReason: 'silence-timed-out' })],
        ['the user', async (world: Awaited<ReturnType<typeof heardDraft>>) => world.session.stop('user')],
        ['an error', async (world: Awaited<ReturnType<typeof heardDraft>>) => world.drop()],
      ])('after %s, a late yes or post it publishes nothing and the user hears the draft was not sent', async (_how, end) => {
        const world = await heardDraft('draft_post');
        await end(world);
        world.userSays('yes');
        world.userSays('post it');
        await world.settle();
        expect(world.sent()).toBe(0);
        expect(world.exits[0].message).toMatch(/^Your draft was not sent\. /);
        expect(world.scheduler.pending()).toBe(0);
      });

      it('a confirmation waiting for its transcript when the call ends never sends', async () => {
        const world = await heardDraft('draft_post');
        await world.toolCall('publish_draft', { draftId: world.id });
        world.session.stop('user');
        world.userSays('yes');
        await world.settle();
        expect(world.sent()).toBe(0);
      });
    });

    describe('B3: every confirmation needs this exact read-back heard to the end', () => {
      it('reads a draft again when yes comes with no sign the read-back was spoken at all', async () => {
        const world = setup();
        await world.session.start();
        world.userSays('post hello from my new app');
        await world.toolCall('draft_post', { text: 'Hello from my new app.' });
        world.userSays('yes');
        expect(world.call.say).toHaveBeenLastCalledWith('Posting to your followers: Hello from my new app. Say "post it" to send it, or "cancel".', true);
        await world.toolCall('publish_draft', { draftId: draftIdOf(world.call.addMessage) });
        await world.scheduler.advance(COUNTDOWN_FALLBACK_MS);
        await world.scheduler.advance(UNDO_WINDOW_MS);
        expect(world.provider.createPost).not.toHaveBeenCalled();
        expect(world.logs).toContain('publish refused {"reason":"notHeard","by":"words"}');
      });

      it('never deletes on a yes said over a delete read-back that it cut off', async () => {
        const mine = { ...maya, uri: 'at://me/post/9', author: { ...maya.author, id: 'did:plc:me' } };
        const world = setup();
        world.provider.getMyLatestPost.mockResolvedValue(mine);
        await world.session.start();
        world.userSays('delete my last post');
        await world.toolCall('draft_delete_my_last_post');
        world.emit({ type: 'speech-update', role: 'assistant', status: 'started', turn: 1 });
        world.emit({ type: 'assistant.speechStarted', source: 'force-say', turn: 1, text: '' });
        world.emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: 'Deleting your post from' });
        world.userSays('yes delete it');
        await world.toolCall('publish_draft', { draftId: draftIdOf(world.call.addMessage) });
        await world.scheduler.advance(COUNTDOWN_FALLBACK_MS);
        await world.scheduler.advance(UNDO_WINDOW_MS);
        expect(world.provider.deletePost).not.toHaveBeenCalled();
        expect(world.call.say.mock.calls.at(-1)?.[0]).toMatch(/^Deleting your post from .*Say "delete it" to delete it, or "cancel"\.$/);
      });
    });

    describe("B4: the model's speech voids the read-back the moment it starts", () => {
      it('refuses a yes that lands while the model is still asking its own question, before its transcript', async () => {
        const { emit, userSays, settle, sent, logs } = await heardDraft('draft_post');
        emit({ type: 'speech-update', role: 'assistant', status: 'started', turn: 2 });
        userSays('yes');
        await settle();
        expect(sent()).toBe(0);
        expect(logs).toContain('yes voided by assistant speech {"by":"timing and words","source":null,"turn":2}');
      });

      it('refuses it as soon as Vapi names the model as the source', async () => {
        const { emit, userSays, settle, sent } = await heardDraft('draft_post');
        emit({ type: 'assistant.speechStarted', source: 'model', turn: 2, text: '' });
        userSays('yes');
        await settle();
        expect(sent()).toBe(0);
      });
    });

    describe('should-fix', () => {
      it('waits for the words behind any tool Vapi sends first, so goodbye ends the call and says the draft was not sent', async () => {
        const { toolCall, userSays, call, exits } = await heardDraft('draft_post');
        await toolCall('end_conversation');
        expect(call.stop).not.toHaveBeenCalled();
        userSays('goodbye, end the call');
        await new Promise<void>((resolve) => setImmediate(() => resolve()));
        expect(call.stop).toHaveBeenCalled();
        expect(exits[0].message).toBe(`Your draft was not sent. ${agentMessages.asleep}`);
      });

      it('waits for the words behind a move Vapi sends first, and moves', async () => {
        const { toolCall, userSays, focus } = await heardDraft('draft_post');
        await toolCall('go_to_post', { direction: 'next' });
        userSays('next');
        await new Promise<void>((resolve) => setImmediate(() => resolve()));
        expect(focus()).toBe(nextPost);
      });

      it("counts words in a force-say segment past the end of every due say() as the model's", async () => {
        const world = setup();
        await world.session.start();
        world.userSays('post hello from my new app');
        await world.toolCall('draft_post', { text: 'Hello from my new app.' });
        world.emit({ type: 'speech-update', role: 'assistant', status: 'started', turn: 1 });
        world.emit({ type: 'assistant.speechStarted', source: 'force-say', turn: 1, text: '' });
        world.emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: 'Posting to your followers: Hello from my new app. Shall I post it?' });
        world.emit({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: 'Want me to like it too?' });
        world.userSays('yes');
        await world.scheduler.advance(COUNTDOWN_FALLBACK_MS);
        await world.scheduler.advance(UNDO_WINDOW_MS);
        expect(world.provider.createPost).not.toHaveBeenCalled();
      });
    });
  });
});
