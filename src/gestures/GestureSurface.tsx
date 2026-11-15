import { createContext, use, useRef, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture, type PanGesture } from 'react-native-gesture-handler';

import { recognizeCircle, type CircleDirection, type Point } from './circle';

type Props = ViewProps & {
  tapsEnabled: boolean;
  onTapTop(): void;
  onTapBottom(): void;
  onCircle(direction: CircleDirection): void;
  onUnrecognizedStroke?: (points: Point[]) => void;
  children: ReactNode;
};

const StrokeGestureContext = createContext<PanGesture | null>(null);

export function useStrokeGesture(): PanGesture | undefined {
  return use(StrokeGestureContext) ?? undefined;
}

export function GestureSurface({ tapsEnabled, onTapTop, onTapBottom, onCircle, onUnrecognizedStroke, children, ...viewProps }: Props) {
  const stroke = useRef<Point[]>([]);
  const height = useRef(0);

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minDistance: 12,
    maxPointers: 1,
    onBegin: (event) => {
      stroke.current = [{ x: event.x, y: event.y }];
    },
    onUpdate: (event) => {
      stroke.current.push({ x: event.x, y: event.y });
    },
    onDeactivate: (event) => {
      if (event.canceled) return;
      const direction = recognizeCircle(stroke.current);
      if (direction) onCircle(direction);
      else onUnrecognizedStroke?.(stroke.current);
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

  return (
    <GestureDetector gesture={useCompetingGestures(pan, tap)}>
      <View
        {...viewProps}
        collapsable={false}
        onLayout={(event) => {
          height.current = event.nativeEvent.layout.height;
        }}>
        <StrokeGestureContext value={pan}>{children}</StrokeGestureContext>
      </View>
    </GestureDetector>
  );
}
