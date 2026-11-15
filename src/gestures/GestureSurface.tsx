import { createContext, use, useMemo, useRef, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture, type PanGesture } from 'react-native-gesture-handler';

import type { CircleDirection, Point } from './circle';
import { classifyStroke } from './stroke';

type Props = ViewProps & {
  tapsEnabled: boolean;
  onTapTop(): void;
  onTapBottom(): void;
  onCircle(direction: CircleDirection): void;
  onUnrecognizedStroke?: (points: Point[]) => void;
  children: ReactNode;
};

type StrokeGesture = { gesture: PanGesture; onScroll(): void };

const StrokeGestureContext = createContext<StrokeGesture | null>(null);

export function useStrokeGesture(): StrokeGesture | null {
  return use(StrokeGestureContext);
}

export function GestureSurface({ tapsEnabled, onTapTop, onTapBottom, onCircle, onUnrecognizedStroke, children, ...viewProps }: Props) {
  const stroke = useRef<Point[]>([]);
  const scrolled = useRef(false);
  const height = useRef(0);

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minDistance: 12,
    maxPointers: 1,
    onBegin: (event) => {
      stroke.current = [{ x: event.x, y: event.y }];
      scrolled.current = false;
    },
    onUpdate: (event) => {
      stroke.current.push({ x: event.x, y: event.y });
    },
    onDeactivate: (event) => {
      if (event.canceled) return;
      const outcome = classifyStroke(stroke.current, scrolled.current);
      if (outcome === 'unrecognized') onUnrecognizedStroke?.(stroke.current);
      else if (outcome !== 'scroll') onCircle(outcome);
    },
  });

  const tap = useTapGesture({
    runOnJS: true,
    disableReanimated: true,
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
    <GestureDetector gesture={useCompetingGestures(pan, tap)}>
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
