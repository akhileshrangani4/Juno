import type { Point } from './circle';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export const SWIPE = {
  minLength: 60,
  maxSlantDegrees: 30,
  minStraightness: 0.8,
  maxDurationMs: 1500,
  flickMs: 350,
};

const MAX_SLANT = Math.tan((SWIPE.maxSlantDegrees * Math.PI) / 180);

export function isMostlyVertical(points: Point[]): boolean {
  if (!points.length) return false;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) <= (Math.max(...ys) - Math.min(...ys)) * MAX_SLANT;
}

export function recognizeSwipe(points: Point[], durationMs: number): SwipeDirection | null {
  if (points.length < 2 || durationMs > SWIPE.maxDurationMs) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length < SWIPE.minLength) return null;
  const travelled = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
  if (length / travelled < SWIPE.minStraightness) return null;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const major = horizontal ? Math.abs(dx) : Math.abs(dy);
  const minor = horizontal ? Math.abs(dy) : Math.abs(dx);
  if (minor > major * MAX_SLANT) return null;
  if (horizontal) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
