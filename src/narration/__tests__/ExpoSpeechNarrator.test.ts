import * as Speech from 'expo-speech';

import { ExpoSpeechNarrator } from '../ExpoSpeechNarrator';

jest.mock('expo-speech', () => ({ maxSpeechInputLength: 4000, speak: jest.fn(), stop: jest.fn(async () => undefined) }));

const speak = Speech.speak as jest.Mock;
const lastCallbacks = () => speak.mock.calls[speak.mock.calls.length - 1][1] as { onDone(): void; onStopped(): void };

describe('ExpoSpeechNarrator.speaking', () => {
  beforeEach(() => speak.mockClear());

  it('is true while a post is read and false once it finishes or is stopped', () => {
    const narrator = new ExpoSpeechNarrator();
    const done = jest.fn();
    narrator.onDone(done);
    expect(narrator.speaking()).toBe(false);
    narrator.speak('A long post');
    expect(narrator.speaking()).toBe(true);
    lastCallbacks().onDone();
    expect(narrator.speaking()).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    narrator.speak('Another post');
    narrator.stop();
    expect(narrator.speaking()).toBe(false);
  });

  it('ignores the stop callback of an utterance that a newer one replaced', () => {
    const narrator = new ExpoSpeechNarrator();
    narrator.speak('First');
    const first = lastCallbacks();
    narrator.speak('Second');
    first.onStopped();
    expect(narrator.speaking()).toBe(true);
  });
});
