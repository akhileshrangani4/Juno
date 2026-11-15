import { cleanup, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { GestureSurface, useStrokeGesture } from '../GestureSurface';

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
});
