import { ALL_GESTURES, circleGesture, GESTURES, gestureHelp, introducedGestures } from '../gestures';

describe('gesture list', () => {
  it('gives every gesture its action, spoken copy and hint', () => {
    for (const gesture of GESTURES) {
      for (const field of ['title', 'name', 'action', 'instruction', 'retry', 'tip', 'hint'] as const) expect(gesture[field].length).toBeGreaterThan(0);
      expect(gesture.modes.length).toBeGreaterThan(0);
    }
  });

  it('builds the help summary from the gestures introduced so far in one short paragraph', () => {
    expect(gestureHelp(introducedGestures([], true), true)).toBe(
      'Gesture help. Tap the top half to go to the previous post. Tap the bottom half to move on to the next post. Draw a circle clockwise to wake the agent after it sleeps. Draw a circle counter-clockwise to put it back to sleep. Swipe left to go back to the previous post. Swipe right to move on to the next post. 4 more gestures are introduced as you go. You can practice the main ones again from account settings.',
    );
    expect(gestureHelp(introducedGestures(['swipeUp', 'swipeDown', 'swipeDownCamera', 'twoFingerHold'], true), true)).not.toContain('more gesture');
    expect(gestureHelp(introducedGestures(['swipeUp'], true), true)).toContain('Swipe up to hear the replies to a post. 3 more gestures');
  });

  it('names only gestures that have been introduced, and never the like to a signed-out user', () => {
    const named = (introduced: Parameters<typeof introducedGestures>[0], signedIn: boolean) => introducedGestures(introduced, signedIn).map((gesture) => gesture.id);
    expect(named([], true)).toEqual(['tapTop', 'tapBottom', 'circleClockwise', 'circleCounterclockwise', 'swipeLeft', 'swipeRight']);
    expect(named(['swipeUp'], true)).toContain('swipeUp');
    expect(named(['twoFingerHold'], true)).toContain('twoFingerHold');
    expect(named(['twoFingerHold'], false)).not.toContain('twoFingerHold');
    expect(gestureHelp(introducedGestures(['twoFingerHold'], false), false)).not.toContain('two fingers');
    expect(gestureHelp(introducedGestures([], false), false)).toContain('3 more gestures');
  });

  it('keeps every tip to one short sentence', () => {
    const tips = ALL_GESTURES.filter((gesture) => gesture.stage === 'tip');
    expect(tips.map((gesture) => gesture.id)).toEqual(['swipeUp', 'swipeDown', 'swipeDownCamera', 'twoFingerHold']);
    for (const { intro } of tips) {
      expect(intro).toMatch(/^Tip: [^.!?]+\.$/);
      expect(intro!.split(' ').length).toBeLessThanOrEqual(12);
    }
  });

  it('teaches swipe down on the posts as the camera and in the replies as going back', () => {
    const down = (mode: 'scroll' | 'comments') => ALL_GESTURES.filter((gesture) => gesture.modes.includes(mode) && gesture.cues.includes('swipeDown')).map((gesture) => gesture.id);
    expect(down('scroll')).toEqual(['swipeDownCamera']);
    expect(down('comments')).toEqual(['swipeDown']);
  });

  it('says the clockwise circle wakes the agent after it sleeps, and the like is held through the buzz until the like sound', () => {
    const help = gestureHelp(introducedGestures(['twoFingerHold'], true), true);
    expect(help).toContain('Draw a circle clockwise to wake the agent after it sleeps.');
    expect(help).toContain('through the buzz until the like sound');
    expect(ALL_GESTURES.find((gesture) => gesture.id === 'twoFingerHold')?.intro).toBe('Tip: to like a post, hold two fingers until the like sound.');
  });

  it('maps circle directions to gestures', () => {
    expect(circleGesture('clockwise')).toBe('circleClockwise');
    expect(circleGesture('counterclockwise')).toBe('circleCounterclockwise');
  });
});
