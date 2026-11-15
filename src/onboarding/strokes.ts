import type { Point } from '@/gestures/circle';

export type StrokeKind = 'curve' | 'small' | 'swipeUp' | 'swipeDown' | 'swipeLeft' | 'swipeRight';

const STRAIGHTNESS = 0.7;
const SMALL_STROKE = 60;

export function classifyStroke(points: Point[]): StrokeKind {
  if (points.length < 2) return 'small';
  const first = points[0];
  const last = points[points.length - 1];
  const length = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (length > 0 && Math.hypot(dx, dy) / length >= STRAIGHTNESS) {
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'swipeUp' : 'swipeDown';
    return dx < 0 ? 'swipeLeft' : 'swipeRight';
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < SMALL_STROKE ? 'small' : 'curve';
}
