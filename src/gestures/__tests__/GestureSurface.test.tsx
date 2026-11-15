import { cleanup, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { GestureSurface, useStrokeGesture } from '../GestureSurface';
import { PRESS } from '../press';

let scrollCard: () => void = () => undefined;

function Card() {
  const stroke = useStrokeGesture();
  useEffect(() => {
    scrollCard = () => stroke?.onScroll();
  }, [stroke]);
  return <Text>post</Text>;
}

const props = { onTapTop: jest.fn(), onTapBottom: jest.fn(), onCircle: jest.fn(), onSwipe: jest.fn(), onTwoFingerHold: jest.fn(), onTwoFingerHoldWarning: jest.fn(), onUnrecognizedStroke: jest.fn() };

async function setup() {
  await render(
    <GestureHandlerRootView>
      <GestureSurface tapsEnabled {...props}>
        <Card />
      </GestureSurface>
    </GestureHandlerRootView>,
  );
  return props;
}

function drawStroke(points: { x: number; y: number }[], durationMs: number, scrolls = false) {
  const pan = createGestureController('surface-stroke');
  pan.begin(points[0]);
  pan.activate(points[0]);
  points.slice(1).forEach((point, i) => {
    jest.advanceTimersByTime(durationMs / (points.length - 1));
    if (scrolls && i === 2) scrollCard();
    pan.update(point);
  });
  pan.end(points[points.length - 1]);
}

const ACTIVE = 4;
const END = 5;
const DOWN = 1;
const MOVE = 2;
const UP = 3;
const setGestureState = jest.fn();
(globalThis as { _setGestureStateSync?: unknown })._setGestureStateSync = setGestureState;

type Finger = { id: number; x: number; y: number };
const finger = (id: number, x = 100 + id * 80, y = 500): Finger => ({ id, x, y });

// Sends touch events to the press gesture the way the native side does, so these tests run the real wiring.
function touch(eventType: number, changed: Finger[], all: Finger[]) {
  const press = getByGestureTestId('surface-press') as unknown as { handlerTag: number; detectorCallbacks: { jsEventHandler(event: unknown): void } };
  const withAbsolute = (fingers: Finger[]) => fingers.map((f) => ({ ...f, absoluteX: f.x, absoluteY: f.y }));
  press.detectorCallbacks.jsEventHandler({
    handlerTag: press.handlerTag,
    eventType,
    state: 2,
    pointerType: 0,
    numberOfTouches: all.length,
    allTouches: withAbsolute(all),
    changedTouches: withAbsolute(changed),
  });
  return press.handlerTag;
}

const claims = (tag: number) => setGestureState.mock.calls.filter(([handler, state]) => handler === tag && state === ACTIVE).length;

const vertical = (from: number, to: number) => Array.from({ length: 11 }, (_, i) => ({ x: 196, y: from + ((to - from) * i) / 10 }));

describe('GestureSurface', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    await setup();
  });
  afterEach(async () => {
    await cleanup();
    jest.useRealTimers();
  });

  it('runs a tap at once, without waiting on any hold', async () => {
    const tap = createGestureController('surface-tap');
    tap.begin({ x: 196, y: 600 });
    tap.activate({ x: 196, y: 600 });
    tap.end({ x: 196, y: 600 });
    expect(props.onTapBottom).toHaveBeenCalledTimes(1);
    expect(props.onTwoFingerHold).not.toHaveBeenCalled();
  });

  it('a slow drag that scrolled the post fires nothing, not even onUnrecognizedStroke', async () => {
    drawStroke(vertical(620, 300), 900, true);
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
    expect(props.onSwipe).not.toHaveBeenCalled();
    expect(props.onCircle).not.toHaveBeenCalled();
  });

  it('a quick flick up opens comments even over a post that scrolled', async () => {
    drawStroke(vertical(620, 300), 200, true);
    expect(props.onSwipe).toHaveBeenCalledWith('up');
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
  });

  it('reads a slower drag over a post that did not scroll as a swipe', async () => {
    drawStroke(vertical(620, 300), 900);
    expect(props.onSwipe).toHaveBeenCalledWith('up');
  });

  it('reports a horizontal swipe as a swipe, never as an unrecognized stroke', async () => {
    drawStroke([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ x: 60 + i * 27, y: 500 })), 300);
    expect(props.onSwipe).toHaveBeenCalledWith('right');
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
  });

  it('reports a swipe as unrecognized on a surface that takes no swipes', async () => {
    await cleanup();
    const { onSwipe, onTwoFingerHold, ...rest } = props;
    await render(
      <GestureHandlerRootView>
        <GestureSurface tapsEnabled {...rest}>
          <Card />
        </GestureSurface>
      </GestureHandlerRootView>,
    );
    drawStroke(vertical(620, 300), 300);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onTwoFingerHold).not.toHaveBeenCalled();
    expect(props.onUnrecognizedStroke).toHaveBeenCalledTimes(1);
  });

  it('reports a stroke that is not a circle, swipe or scroll as unrecognized, with its points', async () => {
    drawStroke(vertical(620, 300), 2000);
    expect(props.onUnrecognizedStroke).toHaveBeenCalledWith(expect.arrayContaining([{ x: 196, y: 620 }]));
  });

  it('likes for two fingers held still through the real press wiring, warning first, and claims the touch', async () => {
    const one = finger(1);
    const two = finger(2);
    const tag = touch(DOWN, [one], [one]);
    jest.advanceTimersByTime(200);
    touch(DOWN, [two], [one, two]);
    jest.advanceTimersByTime(PRESS.holdWarnMs);
    expect(props.onTwoFingerHoldWarning).toHaveBeenCalledTimes(1);
    expect(props.onTwoFingerHold).not.toHaveBeenCalled();
    jest.advanceTimersByTime(PRESS.holdMs - PRESS.holdWarnMs);
    expect(props.onTwoFingerHold).toHaveBeenCalledTimes(1);
    expect(claims(tag)).toBe(1);
    touch(UP, [two], [one]);
    touch(UP, [one], []);
    expect(setGestureState).toHaveBeenLastCalledWith(tag, END);
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
    expect(props.onTapBottom).not.toHaveBeenCalled();
  });

  it('never likes when two fingers drag or one lifts early', async () => {
    const one = finger(1);
    const two = finger(2);
    const tag = touch(DOWN, [one, two], [one, two]);
    touch(MOVE, [], [one, { ...two, y: two.y - 40 }]);
    jest.advanceTimersByTime(3000);
    touch(UP, [one, two], []);
    touch(DOWN, [one, two], [one, two]);
    jest.advanceTimersByTime(PRESS.holdWarnMs + 100);
    touch(UP, [two], [one]);
    jest.advanceTimersByTime(3000);
    touch(UP, [one], []);
    expect(props.onTwoFingerHold).not.toHaveBeenCalled();
    expect(claims(tag)).toBe(0);
  });

  it('claims nothing for a resting finger when no talk hold is connected, so the stroke it then draws still counts', async () => {
    const one = finger(1, 196, 620);
    const tag = touch(DOWN, [one], [one]);
    jest.advanceTimersByTime(3000);
    expect(claims(tag)).toBe(0);
    touch(MOVE, [], [{ ...one, y: 500 }]);
    drawStroke(vertical(620, 300), 300);
    touch(UP, [one], []);
    expect(props.onSwipe).toHaveBeenCalledWith('up');
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
  });

  it('starts and ends a connected talk hold, claims the touch, and never reports it as a stroke', async () => {
    await cleanup();
    const talk = { start: jest.fn(), end: jest.fn() };
    await render(
      <GestureHandlerRootView>
        <GestureSurface tapsEnabled {...props} onTalkHold={talk}>
          <Card />
        </GestureSurface>
      </GestureHandlerRootView>,
    );
    const one = finger(1);
    const tag = touch(DOWN, [one], [one]);
    jest.advanceTimersByTime(PRESS.talkHoldMs - 1);
    expect(talk.start).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(talk.start).toHaveBeenCalledTimes(1);
    expect(claims(tag)).toBe(1);
    jest.advanceTimersByTime(2000);
    touch(UP, [one], []);
    expect(talk.end).toHaveBeenCalledWith(false);
    expect(props.onTwoFingerHold).not.toHaveBeenCalled();
    expect(props.onUnrecognizedStroke).not.toHaveBeenCalled();
  });
});
