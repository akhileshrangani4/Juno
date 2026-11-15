import { assess, guide, GUIDANCE, initialGuidance, tickIntervalMs, TICKS, type Analysis, type Box, type Facing, type GuidanceState } from '../guidance';

const box = (cx: number, cy: number, size = 0.3): Box => ({ x: cx - size / 2, y: cy - size / 2, width: size, height: size });
const frame = (overrides: Partial<Analysis> = {}): Analysis => ({ faces: [], salient: null, sharpness: 200, brightness: 0.5, motion: 0, signature: [], at: 0, ...overrides });
const face = (cx: number, cy: number, size = 0.3) => frame({ faces: [box(cx, cy, size)] });

// Feeds the same frame every 100 ms from start to end and returns every cue spoken.
function run(analysis: Analysis, { facing = 'back' as Facing, from = 0, to = 3000, busy = false, keyOnly = false, state = initialGuidance() } = {}) {
  const cues: { at: number; text: string; kind: string }[] = [];
  let current: GuidanceState = state;
  for (let now = from; now <= to; now += 100) {
    const out = guide(current, analysis, { facing, now, busy, keyOnly });
    current = out.state;
    if (out.cue) cues.push({ at: now, text: out.cue.text, kind: out.cue.kind });
  }
  return { cues, state: current };
}

describe('the direction to move the phone', () => {
  it('follows the subject with the back camera, where the image is the user\'s own view', () => {
    expect(run(face(0.85, 0.5)).cues[0].text).toBe('Move right.');
    expect(run(face(0.15, 0.5)).cues[0].text).toBe('Move left.');
    expect(run(face(0.5, 0.15)).cues[0].text).toBe('Tilt up.');
    expect(run(face(0.5, 0.85)).cues[0].text).toBe('Tilt down.');
  });

  it('flips left and right for the front camera, which faces the user, and keeps up and down', () => {
    expect(run(face(0.85, 0.5), { facing: 'front' }).cues[0].text).toBe('Move left.');
    expect(run(face(0.15, 0.5), { facing: 'front' }).cues[0].text).toBe('Move right.');
    expect(run(face(0.5, 0.15), { facing: 'front' }).cues[0].text).toBe('Move up.');
    expect(run(face(0.5, 0.85), { facing: 'front' }).cues[0].text).toBe('Move down.');
  });

  it('names the larger offset first', () => {
    expect(run(face(0.8, 0.35)).cues[0].text).toBe('Move right.');
    expect(run(face(0.6, 0.1)).cues[0].text).toBe('Tilt up.');
  });

  it('uses the largest face, and the salient object when there is no face', () => {
    expect(run(frame({ faces: [box(0.85, 0.5, 0.1), box(0.2, 0.5, 0.3)] })).cues[0].text).toBe('Move left.');
    expect(run(frame({ salient: box(0.85, 0.5) })).cues[0].text).toBe('Move right.');
  });

  it('holds "centered" a little past the edge once it is centered, so a subject on the line does not flicker', () => {
    expect(assess(face(0.62, 0.5), 'back', false).centered).toBe(false);
    expect(assess(face(0.62, 0.5), 'back', true).centered).toBe(true);
    expect(assess(face(0.67, 0.5), 'back', true).centered).toBe(false);
  });
});

describe('distance', () => {
  it('asks to move closer to a small face and farther from one that fills the frame', () => {
    expect(run(face(0.5, 0.5, 0.1)).cues[0].text).toBe('Move closer.');
    expect(run(face(0.5, 0.5, 0.7)).cues[0].text).toBe('Move farther away.');
  });

  it('does the same for an object by its area', () => {
    expect(run(frame({ salient: box(0.5, 0.5, 0.15) })).cues[0].text).toBe('Move closer.');
    expect(run(frame({ salient: box(0.5, 0.5, 0.95) })).cues[0].text).toBe('Move farther away.');
  });
});

describe('steadiness and the moment to take the picture', () => {
  it('asks to hold steady when the subject is framed but the phone moves or the frame is blurred', () => {
    expect(run(frame({ ...face(0.5, 0.5), motion: 0.2 })).cues[0].text).toBe('Hold steady.');
    expect(run(frame({ ...face(0.5, 0.5), sharpness: 5 })).cues[0].text).toBe('Hold steady.');
  });

  it('says to take the picture once the face has been centered and sharp for a moment, and only once', () => {
    const { cues } = run(face(0.5, 0.5), { to: 6000 });
    expect(cues).toEqual([{ at: GUIDANCE.readyHoldMs, kind: 'ready', text: 'The face is centered. Take the picture now.' }]);
  });

  it('words it for an object too', () => {
    expect(run(frame({ salient: box(0.5, 0.5, 0.4) })).cues[0].text).toBe("It's centered. Take the picture now.");
  });

  it('starts the moment again after the subject drifts away', () => {
    let { state } = run(face(0.5, 0.5), { to: 2000 });
    ({ state } = run(face(0.9, 0.5), { from: 2100, to: 4000, state }));
    const again = run(face(0.5, 0.5), { from: 4100, to: 7000, state });
    expect(again.cues.map((cue) => cue.kind)).toEqual(['ready']);
    expect(again.cues[0].at).toBe(4100 + GUIDANCE.readyHoldMs);
  });
});

describe('throttling', () => {
  it('says nothing for a cue that has not held for a moment', () => {
    let { state } = run(face(0.5, 0.5), { to: 2000 });
    const blip = guide(state, face(0.9, 0.5), { facing: 'back', now: 2100, busy: false, keyOnly: false });
    expect(blip.cue).toBeNull();
    state = blip.state;
    expect(guide(state, face(0.5, 0.5), { facing: 'back', now: 2200, busy: false, keyOnly: false }).cue).toBeNull();
  });

  it('keeps cues at least a second and a half apart, and the same cue four seconds apart', () => {
    const { cues } = run(face(0.9, 0.5), { to: 9000 });
    expect(cues.map((cue) => cue.text)).toEqual(['Move right.', 'Move right.', 'Move right.']);
    expect(cues[1].at - cues[0].at).toBeGreaterThanOrEqual(GUIDANCE.repeatMs);
  });

  it('lets a different cue follow after the gap', () => {
    const first = run(face(0.9, 0.5), { to: 400 });
    const second = run(face(0.5, 0.5, 0.1), { from: 500, to: 3000, state: first.state });
    expect(first.cues.map((cue) => cue.text)).toEqual(['Move right.']);
    expect(second.cues[0].text).toBe('Move closer.');
    expect(second.cues[0].at - first.cues[0].at).toBeGreaterThanOrEqual(GUIDANCE.gapMs);
  });

  it('says a change of direction at once after an overshoot, even back to a direction said a moment ago', () => {
    const right = run(face(0.9, 0.5), { to: 400 });
    const left = run(face(0.1, 0.5), { from: 500, to: 2000, state: right.state });
    const back = run(face(0.9, 0.5), { from: 2100, to: 3600, state: left.state });
    expect([...right.cues, ...left.cues, ...back.cues].map((cue) => cue.text)).toEqual(['Move right.', 'Move left.', 'Move right.']);
    expect(back.cues[0].at - right.cues[0].at).toBeLessThan(GUIDANCE.repeatMs);
  });

  it('never starts a cue while something is being spoken', () => {
    expect(run(face(0.9, 0.5), { busy: true }).cues).toEqual([]);
  });

  it('during a call speaks only key cues and leaves directions and steadiness to the haptics', () => {
    expect(run(face(0.9, 0.5), { keyOnly: true }).cues).toEqual([]);
    expect(run(frame({ ...face(0.5, 0.5), motion: 0.2 }), { keyOnly: true }).cues).toEqual([]);
    expect(run(face(0.5, 0.5, 0.1), { keyOnly: true }).cues[0].text).toBe('Move closer.');
    expect(run(face(0.5, 0.5), { keyOnly: true }).cues[0].kind).toBe('ready');
  });
});

describe('no subject and darkness', () => {
  it('says once that nothing is found, after a moment, and suggests moving slowly', () => {
    const { cues } = run(frame(), { to: 10_000 });
    expect(cues).toEqual([{ at: GUIDANCE.noSubjectMs, kind: 'noSubject', text: "I can't find anything to frame. Move the phone slowly." }]);
  });

  it('says it again only after something was found in between', () => {
    let { state } = run(frame(), { to: 2000 });
    ({ state } = run(face(0.5, 0.5), { from: 2100, to: 2500, state }));
    expect(run(frame(), { from: 2600, to: 6000, state }).cues.map((cue) => cue.kind)).toEqual(['noSubject']);
  });

  it('says when it is too dark before anything else', () => {
    expect(run(frame({ ...face(0.9, 0.5), brightness: 0.05 })).cues[0].text).toBe("It's very dark. Find more light.");
  });
});

describe('haptic ticks', () => {
  const at = (distance: number, centered = false, steady = true) => tickIntervalMs({ distance, centered, steady });

  it('tick faster, smoothly, as the subject nears the center', () => {
    const intervals = [0.7, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0].map((distance) => at(distance)!);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeLessThanOrEqual(intervals[i - 1]);
    for (let i = 2; i < intervals.length; i++) expect(intervals[i]).toBeLessThan(intervals[i - 1]);
    expect(intervals[0]).toBe(TICKS.slowestMs);
    expect(intervals[intervals.length - 1]).toBe(TICKS.fastestMs);
    const steps = intervals.slice(1).map((value, i) => intervals[i] - value);
    expect(Math.max(...steps)).toBeLessThan(200);
  });

  it('stop when the subject is centered and steady, and when there is no subject', () => {
    expect(at(0.02, true, true)).toBeNull();
    expect(at(0.02, true, false)).toBe(at(0.02));
    expect(tickIntervalMs({ distance: null, centered: false, steady: true })).toBeNull();
  });

  it('come from the same measurements as the cues', () => {
    expect(tickIntervalMs(assess(face(0.5, 0.5), 'back', false))).toBeNull();
    expect(tickIntervalMs(assess(face(0.9, 0.5), 'back', false))).toBeGreaterThan(tickIntervalMs(assess(face(0.7, 0.5), 'back', false))!);
  });
});
