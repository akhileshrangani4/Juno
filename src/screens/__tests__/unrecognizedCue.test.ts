import { haptic } from '@/feedback/haptics';
import { createRateLimiter } from '@/gestures/rateLimit';
import { messages } from '@/narration/buildNarration';
import type { Narrator } from '@/narration/Narrator';

import { playUnrecognizedCue } from '../unrecognizedCue';

jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));

function fakeNarrator(speaking: boolean): Narrator & { speak: jest.Mock; stop: jest.Mock } {
  return { speak: jest.fn(), append: jest.fn(), stop: jest.fn(), speaking: () => speaking, setRate: () => undefined, onDone: () => () => undefined };
}

describe('playUnrecognizedCue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plays the haptic and shows the hint at once, and does not cut off a post being read', () => {
    const narrator = fakeNarrator(true);
    const showHint = jest.fn();
    playUnrecognizedCue({ narrator, speaking: narrator.speaking, showHint, allowSpeech: () => true });
    expect(haptic).toHaveBeenCalledWith('unrecognized');
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(narrator.speak).not.toHaveBeenCalled();
    expect(narrator.stop).not.toHaveBeenCalled();
  });

  it('speaks the cue when nothing is being read', () => {
    const narrator = fakeNarrator(false);
    playUnrecognizedCue({ narrator, speaking: narrator.speaking, showHint: jest.fn(), allowSpeech: () => true });
    expect(narrator.speak).toHaveBeenCalledWith(messages.unrecognized);
  });

  it('stays quiet while the post narrator counts as speaking, even when the speech engine is idle', () => {
    const narrator = fakeNarrator(false);
    const showHint = jest.fn();
    playUnrecognizedCue({ narrator, speaking: () => true, showHint, allowSpeech: () => true });
    expect(haptic).toHaveBeenCalledWith('unrecognized');
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(narrator.speak).not.toHaveBeenCalled();
  });

  it('does not use up the spoken rate limit on a cue it stayed quiet for', () => {
    let time = 0;
    const allowSpeech = createRateLimiter(2500, () => time);
    playUnrecognizedCue({ narrator: fakeNarrator(true), speaking: () => true, showHint: jest.fn(), allowSpeech });
    time = 100;
    const idle = fakeNarrator(false);
    playUnrecognizedCue({ narrator: idle, speaking: idle.speaking, showHint: jest.fn(), allowSpeech });
    expect(idle.speak).toHaveBeenCalledTimes(1);
    time = 200;
    playUnrecognizedCue({ narrator: idle, speaking: idle.speaking, showHint: jest.fn(), allowSpeech });
    expect(idle.speak).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(3);
  });
});
