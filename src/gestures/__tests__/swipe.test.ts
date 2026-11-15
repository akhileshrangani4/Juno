import type { Point } from '../circle';
import { recognizeSwipe, SWIPE } from '../swipe';

const line = (from: Point, to: Point, steps = 20): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));

describe('recognizeSwipe', () => {
  it('names the four directions, with y pointing down', () => {
    expect(recognizeSwipe(line({ x: 100, y: 400 }, { x: 300, y: 400 }), 200)).toBe('right');
    expect(recognizeSwipe(line({ x: 300, y: 400 }, { x: 100, y: 400 }), 200)).toBe('left');
    expect(recognizeSwipe(line({ x: 200, y: 600 }, { x: 200, y: 300 }), 200)).toBe('up');
    expect(recognizeSwipe(line({ x: 200, y: 300 }, { x: 200, y: 600 }), 200)).toBe('down');
  });

  it('needs the minimum length', () => {
    expect(recognizeSwipe(line({ x: 100, y: 400 }, { x: 100 + SWIPE.minLength - 1, y: 400 }), 100)).toBeNull();
    expect(recognizeSwipe(line({ x: 100, y: 400 }, { x: 100 + SWIPE.minLength, y: 400 }), 100)).toBe('right');
  });

  it('allows up to 30 degrees of slant and no more', () => {
    expect(recognizeSwipe(line({ x: 100, y: 400 }, { x: 300, y: 400 - 200 * Math.tan(Math.PI / 6) + 1 }), 200)).toBe('right');
    expect(recognizeSwipe(line({ x: 100, y: 400 }, { x: 300, y: 300 - 30 }), 200)).toBeNull();
  });

  it('must be over within the maximum duration', () => {
    const stroke = line({ x: 100, y: 400 }, { x: 300, y: 400 });
    expect(recognizeSwipe(stroke, SWIPE.maxDurationMs)).toBe('right');
    expect(recognizeSwipe(stroke, SWIPE.maxDurationMs + 1)).toBeNull();
  });

  it('must be roughly straight, so a hook or a zigzag is not a swipe', () => {
    const zigzag = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 100 + i * 40, y: 400 + (i % 2) * 60 }));
    expect(recognizeSwipe(zigzag, 200)).toBeNull();
    const hook = [...line({ x: 100, y: 400 }, { x: 300, y: 400 }), ...line({ x: 300, y: 400 }, { x: 220, y: 400 }).slice(1)];
    expect(recognizeSwipe(hook, 200)).toBeNull();
  });
});
