import { recognizeCircle, type CircleDirection, type Point } from './circle';
import { isMostlyVertical, recognizeSwipe, SWIPE, type SwipeDirection } from './swipe';

export type StrokeOutcome = CircleDirection | SwipeDirection | 'scroll' | 'unrecognized';

export function classifyStroke(points: Point[], { scrolled, durationMs }: { scrolled: boolean; durationMs: number }): StrokeOutcome {
  const circle = recognizeCircle(points);
  if (circle) return circle;
  if (scrolled && isMostlyVertical(points) && durationMs > SWIPE.flickMs) return 'scroll';
  return recognizeSwipe(points, durationMs) ?? 'unrecognized';
}
