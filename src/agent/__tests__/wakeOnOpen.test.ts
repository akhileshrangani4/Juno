import { setup as setupTools } from '@/testing/agent';
import { createMemoryStore } from '@/storage/keyValueStore';

import { agentMessages } from '../agentMessages';
import { AgentSession } from '../AgentSession';
import { buildAssistant } from '../assistant';
import { vapiTools } from '../tools';
import type { CallListener, VapiMessage } from '../voiceCall';
import { LaunchWake, WakeOnOpenStore, type LaunchState } from '../wakeOnOpen';

const onFeed: LaunchState = { setting: true, signedIn: true, onFeed: true, feedReady: true, awake: false };

describe('waking the agent when Juno opens', () => {
  it('is on by default, and wakes once when the signed-in feed first has a post', () => {
    const launch = new LaunchWake();
    expect(launch.decide({ ...onFeed, feedReady: false })).toBe('no');
    expect(launch.decide(onFeed)).toBe('wake');
    expect(launch.decide(onFeed)).toBe('no');
  });

  it('does not wake when the setting is off', () => {
    const launch = new LaunchWake();
    expect(launch.decide({ ...onFeed, setting: false })).toBe('no');
    expect(launch.decide(onFeed)).toBe('no');
  });

  it('waits for the stored setting before the first post is read', () => {
    const launch = new LaunchWake();
    expect(launch.decide({ ...onFeed, setting: null })).toBe('wait');
    expect(launch.decide(onFeed)).toBe('wake');
  });

  it('never wakes a second time in a launch, after the agent sleeps or fails to connect', () => {
    const launch = new LaunchWake();
    expect(launch.decide(onFeed)).toBe('wake');
    expect(launch.decide({ ...onFeed, awake: true })).toBe('no');
    expect(launch.decide(onFeed)).toBe('no');
  });

  it('does not wake off the feed (signed out, replies open, no post yet), and wakes once the user reaches it', () => {
    const launch = new LaunchWake();
    expect(launch.decide({ ...onFeed, signedIn: false })).toBe('no');
    expect(launch.decide({ ...onFeed, onFeed: false })).toBe('no');
    expect(launch.decide({ ...onFeed, feedReady: false })).toBe('no');
    expect(launch.decide(onFeed)).toBe('wake');
  });

  it('counts an agent already awake (a camera keep or the circle) as the launch wake, so it is not woken again later', () => {
    const launch = new LaunchWake();
    expect(launch.decide({ ...onFeed, awake: true })).toBe('no');
    expect(launch.decide(onFeed)).toBe('no');
  });

  it('reads the stored choice at the next launch, and an unreadable store keeps the default on', async () => {
    const storage = createMemoryStore();
    const store = new WakeOnOpenStore(storage);
    expect(store.get()).toBeNull();
    expect(await store.load()).toBe(true);
    store.set(false);
    const relaunched = new WakeOnOpenStore(storage);
    expect(await relaunched.load()).toBe(false);
    const broken = new WakeOnOpenStore({ get: () => Promise.reject(new Error('locked')), set: () => Promise.resolve(), remove: () => Promise.resolve() } as never);
    expect(await broken.load()).toBe(true);
  });

  it('switches by voice with one sentence each, and keeps the choice after a relaunch', async () => {
    const tools = setupTools({ readBacksHeard: false });
    const storage = createMemoryStore();
    const store = new WakeOnOpenStore(storage);
    await store.load();
    tools.deps.wakeOnOpen = store;
    let listener: CallListener | null = null;
    const call = {
      start: jest.fn((_assistant: object, next: CallListener) => {
        listener = next;
        return Promise.resolve();
      }),
      stop: jest.fn(),
      say: jest.fn(),
      addMessage: jest.fn(),
    };
    const session = new AgentSession({
      call,
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
    await session.start();
    const toolCall = async (name: string) => {
      listener!.onMessage({ type: 'tool-calls', toolCallList: [{ id: 'call', type: 'function', function: { name, arguments: '{}' } }] } as VapiMessage);
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
    };
    await toolCall('stay_asleep_on_open');
    expect(store.get()).toBe(false);
    expect(call.say).toHaveBeenLastCalledWith(agentMessages.wakeOnOpenOff, expect.anything());
    expect(await new WakeOnOpenStore(storage).load()).toBe(false);
    await toolCall('wake_on_open');
    expect(store.get()).toBe(true);
    expect(call.say).toHaveBeenLastCalledWith(agentMessages.wakeOnOpenOn, expect.anything());
    expect(await new WakeOnOpenStore(storage).load()).toBe(true);
  });

  it('gives the model both tools, narrowly described as being about opening the app', () => {
    const names = buildAssistant({ account: '', settings: '', memories: '', focus: '' } as never).model.tools.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining(['stay_asleep_on_open', 'wake_on_open']));
    for (const name of ['stay_asleep_on_open', 'wake_on_open']) expect(vapiTools.find((tool) => tool.function.name === name)?.function.description).toMatch(/open(s|ing)? (Juno|the app)/);
  });
});
