import { recognizeCircle, resample, signedSweepDegrees, type Point } from '../circle';

type Shape = { degrees?: number; start?: number; rx?: number; ry?: number; steps?: number; jitter?: number; drift?: number };

function arc({ degrees = 360, start = 0, rx = 100, ry = 100, steps = 40, jitter = 0, drift = 0 }: Shape = {}): Point[] {
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2 * jitter;
  };
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const angle = ((start + degrees * t) * Math.PI) / 180;
    return { x: 200 + rx * Math.cos(angle) + drift * t + noise(), y: 300 + ry * Math.sin(angle) + noise() };
  });
}

describe('recognizeCircle', () => {
  it('reads increasing screen angle (y pointing down) as clockwise', () => {
    expect(recognizeCircle(arc())).toBe('clockwise');
    expect(recognizeCircle(arc({ degrees: -360 }))).toBe('counterclockwise');
  });

  it('does not care where the circle starts', () => {
    for (const start of [0, 45, 90, 180, 270]) {
      expect(recognizeCircle(arc({ start }))).toBe('clockwise');
      expect(recognizeCircle(arc({ start, degrees: -360 }))).toBe('counterclockwise');
    }
  });

  it('accepts sloppy circles: unclosed, overshot, squashed, shaky and drifting', () => {
    expect(recognizeCircle(arc({ degrees: 320 }))).toBe('clockwise');
    expect(recognizeCircle(arc({ degrees: -450 }))).toBe('counterclockwise');
    expect(recognizeCircle(arc({ degrees: 720, steps: 80 }))).toBe('clockwise');
    expect(recognizeCircle(arc({ rx: 150, ry: 60 }))).toBe('clockwise');
    expect(recognizeCircle(arc({ jitter: 8 }))).toBe('clockwise');
    expect(recognizeCircle(arc({ degrees: -380, jitter: 6, drift: 50, rx: 90, ry: 120 }))).toBe('counterclockwise');
  });

  it('accepts a circle sampled unevenly, as a slowing finger produces', () => {
    const points = arc({ steps: 200 }).filter((_, i) => i < 100 || i % 10 === 0);
    expect(recognizeCircle(points)).toBe('clockwise');
  });

  it('rejects strokes that are not circles', () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ x: 50 + i * 8, y: 100 + i * 2 }));
    const zigzag = Array.from({ length: 40 }, (_, i) => ({ x: 50 + i * 6, y: 200 + (i % 8 < 4 ? i % 4 : 4 - (i % 4)) * 40 }));
    const backAndForth = [...line, ...line.slice().reverse()];
    const u = [
      ...Array.from({ length: 15 }, (_, i) => ({ x: 100, y: 100 + i * 12 })),
      ...Array.from({ length: 15 }, (_, i) => ({ x: 100 + i * 12, y: 280 })),
      ...Array.from({ length: 15 }, (_, i) => ({ x: 280, y: 280 - i * 12 })),
    ];
    const figureEight = [...arc({ degrees: 360, start: 0 }), ...arc({ degrees: -360, start: 180 }).map((p) => ({ x: p.x + 200, y: p.y }))];
    for (const stroke of [line, zigzag, backAndForth, u, figureEight, arc({ degrees: 180 }), arc({ degrees: 250 })]) {
      expect(recognizeCircle(stroke)).toBeNull();
    }
  });

  it('rejects tiny circles and strokes with too few points', () => {
    expect(recognizeCircle(arc({ rx: 12, ry: 12 }))).toBeNull();
    expect(recognizeCircle(arc({ steps: 5 }))).toBeNull();
    expect(recognizeCircle([])).toBeNull();
  });

  it('honours custom tolerances', () => {
    expect(recognizeCircle(arc({ degrees: 250 }), { minSweepDegrees: 220 })).toBe('clockwise');
    expect(recognizeCircle(arc({ rx: 20, ry: 20 }), { minDiameter: 30 })).toBe('clockwise');
  });
});

describe('signedSweepDegrees', () => {
  it('measures a full turn as about 360 degrees with full consistency', () => {
    const { sweep, consistency } = signedSweepDegrees(arc({ steps: 90 }));
    expect(sweep).toBeCloseTo(360, 0);
    expect(consistency).toBeCloseTo(1, 5);
  });
});

describe('resample', () => {
  it('spaces points evenly along the path and keeps the endpoints', () => {
    const points = resample([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }], 11);
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[5].x).toBeCloseTo(50);
    expect(points[10].x).toBeCloseTo(100);
  });

  it('survives a stroke that never moves', () => {
    expect(resample([{ x: 5, y: 5 }, { x: 5, y: 5 }], 10)).toEqual([{ x: 5, y: 5 }]);
  });
});
