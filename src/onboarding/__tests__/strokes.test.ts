import type { Point } from '@/gestures/circle';

import { classifyStroke } from '../strokes';

const line = (from: Point, to: Point, steps = 20): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));

const arc = (radius: number, degrees: number, steps = 40): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (degrees * Math.PI * i) / (180 * steps);
    return { x: 200 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) };
  });

describe('classifyStroke', () => {
  it('reads straight strokes as swipes in the direction the finger moved', () => {
    expect(classifyStroke(line({ x: 200, y: 500 }, { x: 205, y: 200 }))).toBe('swipeUp');
    expect(classifyStroke(line({ x: 200, y: 200 }, { x: 190, y: 500 }))).toBe('swipeDown');
    expect(classifyStroke(line({ x: 300, y: 300 }, { x: 50, y: 310 }))).toBe('swipeLeft');
    expect(classifyStroke(line({ x: 50, y: 300 }, { x: 300, y: 290 }))).toBe('swipeRight');
  });

  it('reads curved strokes as circle attempts, and tiny ones as too small', () => {
    expect(classifyStroke(arc(100, 200))).toBe('curve');
    expect(classifyStroke(arc(100, 280))).toBe('curve');
    expect(classifyStroke(arc(20, 340))).toBe('small');
  });

  it('treats a stroke with almost no points as too small', () => {
    expect(classifyStroke([{ x: 1, y: 1 }])).toBe('small');
    expect(classifyStroke([])).toBe('small');
  });
});
