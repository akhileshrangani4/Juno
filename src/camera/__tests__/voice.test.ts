import type { Narrator } from '@/narration/Narrator';

import { agentSpeechMs, CameraVoice } from '../voice';

function setup(live: boolean) {
  let now = 0;
  const done = new Set<() => void>();
  let speaking = false;
  const narrator: jest.Mocked<Narrator> = {
    speak: jest.fn<void, [string]>(() => void (speaking = true)),
    append: jest.fn(),
    stop: jest.fn(() => void (speaking = false)),
    speaking: jest.fn(() => speaking),
    setRate: jest.fn(),
    onDone: jest.fn((listener) => {
      done.add(listener);
      return () => void done.delete(listener);
    }),
  };
  const agent = { live: jest.fn(() => live), say: jest.fn(() => live) };
  const voice = new CameraVoice({ narrator, agent, now: () => now, schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  } });
  return {
    voice,
    narrator,
    agent,
    advance: (ms: number) => {
      now += ms;
      jest.advanceTimersByTime(ms);
    },
    finish: () => {
      speaking = false;
      [...done].forEach((listener) => listener());
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('one voice', () => {
  it('with no call, speaks everything on the device and never through the agent', async () => {
    const { voice, narrator, agent, finish } = setup(false);
    const spoken = voice.speak('Move left.', 'cue');
    expect(narrator.speak).toHaveBeenCalledWith('Move left.');
    expect(voice.busy()).toBe(true);
    finish();
    await expect(spoken).resolves.toBe(true);
    void voice.speak('A desk with a laptop.', 'description');
    expect(narrator.speak).toHaveBeenLastCalledWith('A desk with a laptop.');
    expect(agent.say).not.toHaveBeenCalled();
  });

  it('during a call, speaks through the agent only, drops fine cues, and is busy while the agent talks', async () => {
    const { voice, narrator, agent, advance } = setup(true);
    await expect(voice.speak('Move left.', 'cue')).resolves.toBe(false);
    expect(agent.say).not.toHaveBeenCalled();
    const spoken = voice.speak('The face is centered. Take the picture now.', 'keyCue');
    expect(agent.say).toHaveBeenCalledWith('The face is centered. Take the picture now.');
    expect(voice.busy()).toBe(true);
    advance(agentSpeechMs('The face is centered. Take the picture now.'));
    await expect(spoken).resolves.toBe(true);
    expect(voice.busy()).toBe(false);
    void voice.speak('A red mug on a desk.', 'description');
    void voice.speak('Front camera.', 'status');
    expect(agent.say).toHaveBeenCalledTimes(3);
    voice.stop();
    expect(narrator.speak).not.toHaveBeenCalled();
    expect(narrator.stop).not.toHaveBeenCalled();
  });
});
