export type Point = { x: number; y: number };
export type CircleDirection = 'clockwise' | 'counterclockwise';

export type CircleOptions = {
  minSweepDegrees?: number;
  minDiameter?: number;
  minConsistency?: number;
  samples?: number;
};

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function resample(points: Point[], count: number): Point[] {
  const total = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
  if (points.length < 2 || total === 0) return points.slice(0, 1);
  const step = total / (count - 1);
  const result: Point[] = [points[0]];
  let previous = points[0];
  let travelled = 0;
  for (let i = 1; i < points.length; ) {
    const segment = distance(previous, points[i]);
    if (travelled + segment < step || segment === 0) {
      travelled += segment;
      previous = points[i];
      i += 1;
      continue;
    }
    const t = (step - travelled) / segment;
    previous = { x: previous.x + t * (points[i].x - previous.x), y: previous.y + t * (points[i].y - previous.y) };
    result.push(previous);
    travelled = 0;
  }
  if (result.length < count) result.push(points[points.length - 1]);
  return result;
}

export function signedSweepDegrees(points: Point[]): { sweep: number; consistency: number } {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  let sweep = 0;
  let positive = 0;
  let negative = 0;
  for (let i = 1; i < points.length; i += 1) {
    const ax = points[i - 1].x - center.x;
    const ay = points[i - 1].y - center.y;
    const bx = points[i].x - center.x;
    const by = points[i].y - center.y;
    const delta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    sweep += delta;
    if (delta > 0) positive += Math.abs(delta);
    else negative += Math.abs(delta);
  }
  const turning = positive + negative;
  return {
    sweep: (sweep * 180) / Math.PI,
    consistency: turning === 0 ? 0 : Math.max(positive, negative) / turning,
  };
}

export function recognizeCircle(
  points: Point[],
  { minSweepDegrees = 300, minDiameter = 60, minConsistency = 0.85, samples = 48 }: CircleOptions = {},
): CircleDirection | null {
  if (points.length < 8) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < minDiameter) return null;
  const { sweep, consistency } = signedSweepDegrees(resample(points, samples));
  if (Math.abs(sweep) < minSweepDegrees || consistency < minConsistency) return null;
  return sweep > 0 ? 'clockwise' : 'counterclockwise';
}
