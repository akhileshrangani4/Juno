import { setup as setupTools } from '@/testing/agent';

import { AgentSession, type EndReason } from '../AgentSession';
import { voiceCalls, type CallObject, type SdkEvents, type VapiSdk } from '../vapiLifecycle';

// A stand-in for Vapi's React Native SDK 0.3.0 and Daily, keeping the parts that matter here: start() creates the web
// call, then the app's one Daily call object, then joins; stop() cleans up only a call object that already exists;
// a second call object while one is alive throws Daily's duplicate error, which start() reports as an error event
// and a null result; and Vapi's server ends an orphaned call long after.
function world() {
  let alive: (CallObject & { id: number }) | null = null;
  let made = 0;
  const pendingWebCalls: (() => void)[] = [];
  const pendingJoins: (() => void)[] = [];
  const clients: { events: SdkEvents; sdk: VapiSdk; serverEnds(): void }[] = [];
  let joinsHang = false;

  const createCallObject = () => {
    if (alive && !alive.isDestroyed()) throw new Error('Duplicate DailyIframe instances are not allowed');
    let destroyed = false;
    const object = { id: ++made, isDestroyed: () => destroyed, destroy: async () => void (destroyed = true) };
    alive = object;
    return object;
  };

  const newSdk = (_key: string, events: SdkEvents): VapiSdk => {
    let started = false;
    let call: CallObject | null = null;
    const cleanup = async () => {
      if (!call) return;
      started = false;
      await call.destroy();
      call = null;
      events.end();
    };
    const sdk: VapiSdk = {
      async start() {
        if (started) return null;
        started = true;
        try {
          await new Promise<void>((resolve) => pendingWebCalls.push(resolve));
          try {
            call = createCallObject();
          } catch (error) {
            events.error({ type: 'daily-call-object-creation-error', error: {} });
            throw error;
          }
          if (!joinsHang) await new Promise<void>((resolve) => pendingJoins.push(resolve));
          else await new Promise<void>(() => undefined);
          events.joined();
          return { id: 'web-call' };
        } catch (error) {
          events.error(error);
          void cleanup();
          return null;
        }
      },
      stop: () => void cleanup(),
      say: () => undefined,
      send: () => undefined,
      callObject: () => call,
    };
    clients.push({ events, sdk, serverEnds: () => void cleanup() });
    return sdk;
  };

  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  // Lets every web call and join in flight finish, as the network would.
  const network = async () => {
    for (let round = 0; round < 5; round++) {
      while (pendingWebCalls.length || pendingJoins.length) {
        pendingWebCalls.splice(0).forEach((resolve) => resolve());
        await settle();
        pendingJoins.splice(0).forEach((resolve) => resolve());
        await settle();
      }
      await settle();
    }
  };
  return {
    webCallsReturn: async () => {
      pendingWebCalls.splice(0).forEach((resolve) => resolve());
      await settle();
    },
    newSdk,
    clients,
    network,
    settle,
    hangJoins: () => void (joinsHang = true),
    callObjectsAlive: () => (alive && !alive.isDestroyed() ? 1 : 0),
    existingCallObject: () => alive,
  };
}

const listener = () => ({ onMessage: jest.fn(), onEnd: jest.fn(), onError: jest.fn() });

describe('the Vapi call lifecycle', () => {
  it('reproduces the phone: stopping the bare SDK before its call object exists leaves a call that blocks the next one', async () => {
    const w = world();
    const first = w.newSdk('key', { message: jest.fn(), end: jest.fn(), error: jest.fn(), joined: jest.fn() });
    const firstStart = first.start({});
    first.stop();
    await w.network();
    await firstStart;
    expect(w.callObjectsAlive()).toBe(1);
    const errors: unknown[] = [];
    const second = w.newSdk('key', { message: jest.fn(), end: jest.fn(), error: (error) => errors.push(error), joined: jest.fn() });
    const secondStart = second.start({});
    await w.network();
    expect(await secondStart).toBeNull();
    expect(errors.some((error) => error instanceof Error && /Duplicate DailyIframe/.test(error.message))).toBe(true);
  });

  it.each([
    ['before the web call exists', 0],
    ['while it joins', 1],
  ])('tears the call down when the user leaves %s, so the next wake connects', async (_when, webCallsFirst) => {
    const w = world();
    const createVoiceCall = voiceCalls({ newSdk: w.newSdk, existingCallObject: w.existingCallObject, wait: () => new Promise(() => undefined) });
    const first = createVoiceCall('key');
    const firstStart = first.start({}, listener());
    await w.settle();
    if (webCallsFirst) await w.webCallsReturn();
    expect(w.callObjectsAlive()).toBe(webCallsFirst);
    first.stop();
    const next = createVoiceCall('key');
    const nextListener = listener();
    const nextStart = next.start({}, nextListener);
    await w.network();
    await firstStart;
    await expect(nextStart).resolves.toBeUndefined();
    expect(w.callObjectsAlive()).toBe(1);
    expect(nextListener.onError).not.toHaveBeenCalled();
  });

  it('a wake while the last call is still tearing down waits for it, but only so long', async () => {
    const w = world();
    w.hangJoins();
    let waits = 0;
    const createVoiceCall = voiceCalls({ newSdk: w.newSdk, existingCallObject: w.existingCallObject, wait: async () => void waits++ });
    const first = createVoiceCall('key');
    void first.start({}, listener());
    await w.network();
    first.stop();
    await w.settle();
    expect(w.callObjectsAlive()).toBe(0);
    expect(waits).toBeGreaterThan(0);
  });

  it('destroys a stale call object it finds and tries once more', async () => {
    const w = world();
    const stray = w.newSdk('key', { message: jest.fn(), end: jest.fn(), error: jest.fn(), joined: jest.fn() });
    const strayStart = stray.start({});
    await w.network();
    await strayStart;
    expect(w.callObjectsAlive()).toBe(1);
    const createVoiceCall = voiceCalls({ newSdk: w.newSdk, existingCallObject: w.existingCallObject, wait: async () => undefined });
    const call = createVoiceCall('key');
    const started = call.start({}, listener());
    await w.network();
    await expect(started).resolves.toBeUndefined();
    expect(w.clients).toHaveLength(3);
    expect(w.callObjectsAlive()).toBe(1);
  });

  it('says a plain connect failure when the retry fails too', async () => {
    const stuck = world();
    const stuckObject = { isDestroyed: () => false, destroy: async () => undefined };
    const blocked = voiceCalls({ newSdk: stuck.newSdk, existingCallObject: () => stuckObject, wait: async () => undefined })('key');
    const holder = stuck.newSdk('key', { message: jest.fn(), end: jest.fn(), error: jest.fn(), joined: jest.fn() });
    void holder.start({});
    await stuck.network();
    const failing = expect(blocked.start({}, listener())).rejects.toThrow('A previous call is still open');
    await stuck.network();
    await failing;
    expect(stuck.clients).toHaveLength(3);
  });

  // The device log 721d9ab-wake-after-early-exit.log: a wake, an exit one second later while the call was still
  // connecting, then five wakes that each failed with the duplicate error until Vapi ejected the orphan.
  it('replays the phone: wake, leave mid-connect, wake, several times in a row, and every wake connects', async () => {
    const w = world();
    const createVoiceCall = voiceCalls({ newSdk: w.newSdk, existingCallObject: w.existingCallObject, wait: () => new Promise(() => undefined) });
    const exits: EndReason[] = [];
    const logs: string[] = [];
    const wake = () => {
      const tools = setupTools({ readBacksHeard: false });
      const session = new AgentSession({
        call: createVoiceCall('key'),
        handlers: tools.handlers,
        conversation: tools.conversation,
        microphone: async () => 'granted',
        assistant: async () => ({ name: 'test' }),
        status: () => undefined,
        connecting: () => undefined,
        listening: () => undefined,
        exit: (reason) => exits.push(reason),
        schedule: tools.scheduler.schedule,
        now: tools.scheduler.now,
        log: (event) => logs.push(event),
      });
      return { session, started: session.start() };
    };
    for (let round = 0; round < 4; round++) {
      const early = wake();
      await w.settle();
      early.session.stop('user');
      await early.started;
      await w.network();
    }
    const last = wake();
    await w.network();
    await last.started;
    expect(logs.filter((event) => event === 'connected')).toHaveLength(1);
    expect(logs).not.toContain('connect failed');
    expect(exits).toEqual(['user', 'user', 'user', 'user']);
    expect(w.callObjectsAlive()).toBe(1);
    last.session.stop('user');
    await w.network();
    expect(w.callObjectsAlive()).toBe(0);
  });
});
