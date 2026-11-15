import type { Point } from '../circle';
import { classifyStroke } from '../stroke';

const line = (from: Point, to: Point, steps = 30): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));

const circle = (degrees = 360): Point[] =>
  Array.from({ length: 41 }, (_, i) => {
    const angle = (degrees * (i / 40) * Math.PI) / 180;
    return { x: 200 + 100 * Math.cos(angle), y: 300 + 100 * Math.sin(angle) };
  });

describe('classifyStroke', () => {
  it('treats a vertical drag that scrolled the post as a scroll, with no cue', () => {
    expect(classifyStroke(line({ x: 196, y: 620 }, { x: 196, y: 300 }), true)).toBe('scroll');
    expect(classifyStroke(line({ x: 196, y: 300 }, { x: 196, y: 620 }), true)).toBe('scroll');
    expect(classifyStroke(line({ x: 180, y: 620 }, { x: 260, y: 300 }), true)).toBe('scroll');
  });

  it('still reports a vertical drag as unrecognized when nothing scrolled, wherever it started', () => {
    expect(classifyStroke(line({ x: 196, y: 620 }, { x: 196, y: 300 }), false)).toBe('unrecognized');
  });

  it('still reports horizontal and diagonal strokes over a scrolling post as unrecognized', () => {
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 640 }), true)).toBe('unrecognized');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 400 }), true)).toBe('unrecognized');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 640 }), false)).toBe('unrecognized');
  });

  it('recognizes a circle drawn over a long post even though the post scrolled under it', () => {
    expect(classifyStroke(circle(), true)).toBe('clockwise');
    expect(classifyStroke(circle(-360), true)).toBe('counterclockwise');
    expect(classifyStroke(circle(), false)).toBe('clockwise');
  });

  it('reports an empty stroke as unrecognized', () => {
    expect(classifyStroke([], true)).toBe('unrecognized');
  });
});
