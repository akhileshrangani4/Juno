import type { Point } from '../circle';
import { classifyStroke } from '../stroke';

const line = (from: Point, to: Point, steps = 30): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));

const ellipse = ({ degrees = 360, start = 0, rx = 100, ry = 100 } = {}): Point[] =>
  Array.from({ length: 61 }, (_, i) => {
    const angle = ((start + degrees * (i / 60)) * Math.PI) / 180;
    return { x: 200 + rx * Math.cos(angle), y: 300 + ry * Math.sin(angle) };
  });

const flick = { durationMs: 200 };
const drag = { durationMs: 900 };
const dawdle = { durationMs: 2000 };
const up = line({ x: 196, y: 620 }, { x: 196, y: 300 });

describe('classifyStroke', () => {
  it('checks circles first, even when the post scrolled under them or they were quick', () => {
    expect(classifyStroke(ellipse(), { scrolled: true, ...drag })).toBe('clockwise');
    expect(classifyStroke(ellipse({ degrees: -360 }), { scrolled: true, ...flick })).toBe('counterclockwise');
    expect(classifyStroke(ellipse(), { scrolled: false, ...drag })).toBe('clockwise');
  });

  it('never takes the start of a circle for a swipe', () => {
    const circle = ellipse({ rx: 160, ry: 50, start: -120 });
    expect(classifyStroke(circle.slice(0, 11), { scrolled: false, ...flick })).toBe('right');
    expect(classifyStroke(circle, { scrolled: false, ...flick })).toBe('clockwise');
  });

  it('on a long post, a quick flick up opens comments and a slower drag only scrolls', () => {
    expect(classifyStroke(up, { scrolled: true, ...flick })).toBe('up');
    expect(classifyStroke(up, { scrolled: true, ...drag })).toBe('scroll');
    expect(classifyStroke(line({ x: 180, y: 620 }, { x: 260, y: 300 }), { scrolled: true, ...drag })).toBe('scroll');
    expect(classifyStroke(line({ x: 196, y: 300 }, { x: 196, y: 620 }), { scrolled: true, ...drag })).toBe('scroll');
  });

  it('reads the four swipes the same on long and short posts', () => {
    expect(classifyStroke(up, { scrolled: false, ...drag })).toBe('up');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 640 }), { scrolled: true, ...drag })).toBe('right');
    for (const scrolled of [true, false]) {
      expect(classifyStroke(up, { scrolled, ...flick })).toBe('up');
      expect(classifyStroke(line({ x: 196, y: 300 }, { x: 196, y: 620 }), { scrolled, ...flick })).toBe('down');
      expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 640 }), { scrolled, ...flick })).toBe('right');
      expect(classifyStroke(line({ x: 320, y: 640 }, { x: 80, y: 640 }), { scrolled, ...flick })).toBe('left');
    }
  });

  it('reports dawdling strokes, diagonals and short strokes as unrecognized', () => {
    expect(classifyStroke(up, { scrolled: false, ...dawdle })).toBe('unrecognized');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 640 }), { scrolled: false, ...dawdle })).toBe('unrecognized');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 320, y: 400 }), { scrolled: true, ...flick })).toBe('unrecognized');
    expect(classifyStroke(line({ x: 80, y: 640 }, { x: 120, y: 640 }), { scrolled: false, ...flick })).toBe('unrecognized');
    expect(classifyStroke([], { scrolled: true, ...drag })).toBe('unrecognized');
  });
});
