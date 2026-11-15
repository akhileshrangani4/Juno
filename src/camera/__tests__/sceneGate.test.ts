import { gateScene, initialGate, markDescribed, SCENE, signatureDistance, type GateState, type SceneInput } from '../sceneGate';

const flat = (value: number) => Array.from({ length: 64 }, () => value);
const input = (overrides: Partial<SceneInput> = {}): SceneInput => ({ signature: flat(0.5), people: 0, motion: 0, now: 0, busy: false, inflight: false, ...overrides });

function feed(state: GateState, base: Partial<SceneInput>, from: number, to: number) {
  const asked: number[] = [];
  for (let now = from; now <= to; now += 125) {
    const out = gateScene(state, input({ ...base, now }));
    state = out.state;
    if (out.describe) asked.push(now);
  }
  return { state, asked };
}

describe('the scene-change gate', () => {
  it('describes on entering, once the phone has settled', () => {
    const { asked } = feed(initialGate(), {}, 0, 3000);
    expect(asked).toEqual([Math.ceil((SCENE.settleMs + 125) / 125) * 125]);
  });

  it('costs nothing while the view stays the same', () => {
    const { state } = feed(initialGate(), {}, 0, 3000);
    expect(feed(state, {}, 3125, 60_000).asked).toEqual([]);
  });

  it('describes again when the view changes, after settling, and not sooner than the minimum gap', () => {
    const first = feed(initialGate(), {}, 0, 2000);
    const changed = feed(first.state, { signature: flat(0.8) }, 2125, 20_000);
    expect(changed.asked).toHaveLength(1);
    expect(changed.asked[0] - first.asked[0]).toBeGreaterThanOrEqual(SCENE.minUnpromptedMs);
  });

  it('treats a person entering the view as a change even when brightness barely moves', () => {
    const first = feed(initialGate(), {}, 0, 2000);
    expect(feed(first.state, { people: 1 }, 2125, 20_000).asked).toHaveLength(1);
  });

  it('waits while the phone is moving', () => {
    let state = initialGate();
    const asked: number[] = [];
    for (let now = 0; now <= 5000; now += 125) {
      const out = gateScene(state, input({ now, signature: flat((now / 125) % 2 ? 0.2 : 0.6), motion: 0.1 }));
      state = out.state;
      if (out.describe) asked.push(now);
    }
    expect(asked).toEqual([]);
  });

  it('never asks while something is being spoken or another description is on its way', () => {
    expect(feed(initialGate(), { busy: true }, 0, 5000).asked).toEqual([]);
    expect(feed(initialGate(), { inflight: true }, 0, 5000).asked).toEqual([]);
  });

  it('starts again from an asked description', () => {
    const first = feed(initialGate(), {}, 0, 2000);
    const marked = markDescribed(first.state, { signature: flat(0.8), people: 0, now: 2500 });
    expect(feed(marked, { signature: flat(0.8) }, 2625, 30_000).asked).toEqual([]);
  });

  it('measures change as the mean difference of the signature', () => {
    expect(signatureDistance(flat(0.5), flat(0.5))).toBe(0);
    expect(signatureDistance(flat(0.5), flat(0.6))).toBeCloseTo(0.1);
    expect(signatureDistance([], [])).toBe(1);
  });
});
