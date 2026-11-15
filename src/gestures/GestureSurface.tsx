import { createContext, use, useMemo, useRef, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { GestureDetector, useCompetingGestures, useLongPressGesture, usePanGesture, useTapGesture, type PanGesture } from 'react-native-gesture-handler';

import type { CircleDirection, Point } from './circle';
import { classifyStroke } from './stroke';
import type { SwipeDirection } from './swipe';

export const HOLD_MS = 600;

type Props = ViewProps & {
  tapsEnabled: boolean;
  onTapTop(): void;
  onTapBottom(): void;
  onCircle(direction: CircleDirection): void;
  onSwipe?: (direction: SwipeDirection) => void;
  onHold?: () => void;
  onUnrecognizedStroke?: (points: Point[]) => void;
  children: ReactNode;
};

type StrokeGesture = { gesture: PanGesture; onScroll(): void };

const StrokeGestureContext = createContext<StrokeGesture | null>(null);

export function useStrokeGesture(): StrokeGesture | null {
  return use(StrokeGestureContext);
}

export function GestureSurface({ tapsEnabled, onTapTop, onTapBottom, onCircle, onSwipe, onHold, onUnrecognizedStroke, children, ...viewProps }: Props) {
  const stroke = useRef<Point[]>([]);
  const startedAt = useRef(0);
  const scrolled = useRef(false);
  const height = useRef(0);

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    testID: 'surface-stroke',
    minDistance: 12,
    maxPointers: 1,
    onBegin: (event) => {
      stroke.current = [{ x: event.x, y: event.y }];
      startedAt.current = Date.now();
      scrolled.current = false;
    },
    onUpdate: (event) => {
      stroke.current.push({ x: event.x, y: event.y });
    },
    onDeactivate: (event) => {
      if (event.canceled) return;
      const outcome = classifyStroke(stroke.current, { scrolled: scrolled.current, durationMs: Date.now() - startedAt.current });
      switch (outcome) {
        case 'scroll':
          return;
        case 'unrecognized':
          return onUnrecognizedStroke?.(stroke.current);
        case 'clockwise':
        case 'counterclockwise':
          return onCircle(outcome);
        default:
          return onSwipe ? onSwipe(outcome) : onUnrecognizedStroke?.(stroke.current);
      }
    },
  });

  const hold = useLongPressGesture({
    runOnJS: true,
    disableReanimated: true,
    testID: 'surface-hold',
    enabled: !!onHold,
    minDuration: HOLD_MS,
    maxDistance: 12,
    onActivate: () => onHold?.(),
  });

  const tap = useTapGesture({
    runOnJS: true,
    disableReanimated: true,
    testID: 'surface-tap',
    enabled: tapsEnabled,
    maxDistance: 12,
    maxDuration: 800,
    onActivate: (event) => {
      if (event.y < height.current / 2) onTapTop();
      else onTapBottom();
    },
  });

  const strokeGesture = useMemo(
    () => ({
      gesture: pan,
      onScroll: () => {
        scrolled.current = true;
      },
    }),
    [pan],
  );

  return (
    <GestureDetector gesture={useCompetingGestures(pan, hold, tap)}>
      <View
        {...viewProps}
        collapsable={false}
        onLayout={(event) => {
          height.current = event.nativeEvent.layout.height;
        }}>
        <StrokeGestureContext value={strokeGesture}>{children}</StrokeGestureContext>
      </View>
    </GestureDetector>
  );
}
