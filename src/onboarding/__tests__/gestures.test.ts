import { circleGesture, GESTURES, gestureHelp } from '../gestures';

describe('gesture list', () => {
  it('gives every gesture its action, spoken copy and hint', () => {
    for (const gesture of GESTURES) {
      for (const field of ['title', 'name', 'action', 'instruction', 'retry', 'tip', 'hint'] as const) expect(gesture[field].length).toBeGreaterThan(0);
      expect(gesture.modes.length).toBeGreaterThan(0);
    }
  });

  it('builds the help summary from the list in one short paragraph', () => {
    expect(gestureHelp()).toBe(
      'Gesture help. Tap the top half to go back to the previous post. Tap the bottom half to move on to the next post. Draw a circle clockwise to wake the voice agent. Draw a circle counter-clockwise to put the agent back to sleep. You can practice them again from account settings.',
    );
    expect(gestureHelp([{ ...GESTURES[0], title: 'Swipe left', action: 'go back' }])).toBe(
      'Gesture help. Swipe left to go back. You can practice them again from account settings.',
    );
  });

  it('maps circle directions to gestures', () => {
    expect(circleGesture('clockwise')).toBe('circleClockwise');
    expect(circleGesture('counterclockwise')).toBe('circleCounterclockwise');
  });
});
