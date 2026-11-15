import { recognizeCircle, type CircleDirection, type Point } from './circle';

const MAX_SCROLL_SLANT = Math.tan(Math.PI / 6);

export type StrokeOutcome = CircleDirection | 'scroll' | 'unrecognized';

export function classifyStroke(points: Point[], scrolled: boolean): StrokeOutcome {
  const circle = recognizeCircle(points);
  if (circle) return circle;
  if (!scrolled || !points.length) return 'unrecognized';
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return width <= height * MAX_SCROLL_SLANT ? 'scroll' : 'unrecognized';
}
