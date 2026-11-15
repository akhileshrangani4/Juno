import { createContext, use, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { GestureDetector, GestureStateManager, useCompetingGestures, useManualGesture, usePanGesture, useTapGesture, type PanGesture } from 'react-native-gesture-handler';

import type { CircleDirection, Point } from './circle';
import { PRESS, PressTracker, type Touch } from './press';
import { classifyStroke } from './stroke';
import type { SwipeDirection } from './swipe';

type Props = ViewProps & {
  tapsEnabled: boolean;
  onTapTop(): void;
  onTapBottom(): void;
  onCircle(direction: CircleDirection): void;
  onSwipe?: (direction: SwipeDirection) => void;
  // A two-finger press and hold (see PRESS), and its warning a moment before, while lifting still cancels it.
  onTwoFingerHold?: () => void;
  onTwoFingerHoldWarning?: () => void;
  // A one-finger press and hold, kept for talking to the agent: start once it has been held still past the tap window,
  // end when the finger lifts, or end(true) when the system takes the touch away.
  onTalkHold?: { start(): void; end(cancelled: boolean): void };
  onUnrecognizedStroke?: (points: Point[]) => void;
  children: ReactNode;
};

type StrokeGesture = { gesture: PanGesture; onScroll(): void };

const StrokeGestureContext = createContext<StrokeGesture | null>(null);

export function useStrokeGesture(): StrokeGesture | null {
  return use(StrokeGestureContext);
}

export function GestureSurface({ tapsEnabled, onTapTop, onTapBottom, onCircle, onSwipe, onTwoFingerHold, onTwoFingerHoldWarning, onTalkHold, onUnrecognizedStroke, children, ...viewProps }: Props) {
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

  const latest = useRef({ onTwoFingerHold, onTwoFingerHoldWarning, onTalkHold });
  useEffect(() => {
    latest.current = { onTwoFingerHold, onTwoFingerHoldWarning, onTalkHold };
  });
  const handlerTag = useRef(0);
  const claimed = useRef(false);
  const trackerRef = useRef<PressTracker | null>(null);
  const tracker = () =>
    (trackerRef.current ??= new PressTracker(
      {
        onLikeWarning: () => latest.current.onTwoFingerHoldWarning?.(),
        onLike: () => latest.current.onTwoFingerHold?.(),
        onTalkStart: () => latest.current.onTalkHold?.start(),
        onTalkEnd: (cancelled) => latest.current.onTalkHold?.end(cancelled),
        claim: () => {
          claimed.current = true;
          GestureStateManager.activate(handlerTag.current);
        },
      },
      (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      Date.now,
    ));
  const touches = (event: { allTouches: Touch[] }) => event.allTouches.map(({ id, x, y }) => ({ id, x, y }));
  const press = useManualGesture({
    runOnJS: true,
    disableReanimated: true,
    testID: 'surface-press',
    onTouchesDown: (event) => {
      handlerTag.current = event.handlerTag;
      tracker().down(touches({ allTouches: event.changedTouches }));
    },
    onTouchesMove: (event) => tracker().move(touches(event)),
    onTouchesUp: (event) => {
      tracker().up(touches({ allTouches: event.changedTouches }));
      if (event.numberOfTouches > 0) return;
      if (claimed.current) GestureStateManager.deactivate(event.handlerTag);
      else GestureStateManager.fail(event.handlerTag);
      claimed.current = false;
    },
    onFinalize: () => {
      tracker().cancel();
      claimed.current = false;
    },
  });

  const tap = useTapGesture({
    runOnJS: true,
    disableReanimated: true,
    testID: 'surface-tap',
    enabled: tapsEnabled,
    maxDistance: PRESS.slopPt,
    maxDuration: PRESS.tapMaxMs,
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
    <GestureDetector gesture={useCompetingGestures(pan, press, tap)}>
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
