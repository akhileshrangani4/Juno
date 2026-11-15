import { GESTURES, type GestureId, type TaughtGesture } from '../gestures';
import { practiceReducer, SETTLE_MS, startPractice, TIP_EVERY, type PracticeInput, type PracticeResult } from '../practice';

const CAPTION_BUDGET = 320;

const gesture = (id: GestureId): PracticeInput => ({ kind: 'gesture', gesture: id });
const stroke = (kind: 'curve' | 'small' | 'swipeUp'): PracticeInput => ({ kind: 'stroke', stroke: kind });

function run(inputs: PracticeInput[], gestures: TaughtGesture[] = GESTURES) {
  let at = 0;
  let result: PracticeResult = startPractice(at, gestures);
  const results: (PracticeResult | null)[] = [];
  for (const input of inputs) {
    at += SETTLE_MS;
    const next = practiceReducer(result.state, { type: 'input', input, at }, gestures);
    results.push(next);
    if (next) result = next;
  }
  return { result, results, at };
}

describe('startPractice', () => {
  it('speaks the welcome, how to skip and the first instruction', () => {
    const { state, feedback } = startPractice(0);
    expect(state).toEqual({ phase: 'practicing', step: 0, misses: 0, readyAt: 0 });
    expect(feedback?.text).toContain("Let's practice 4 gestures, one at a time.");
    expect(feedback?.text).toContain('press Skip practice at the bottom right');
    expect(feedback?.text).toContain('choose it from the VoiceOver actions');
    expect(feedback?.text).toContain('with Voice Control, say: tap Skip practice');
    expect(feedback?.text).toContain(`Step 1 of 4. ${GESTURES[0].instruction}`);
  });
});

describe('practiceReducer', () => {
  it('teaches the gestures in order: top tap, bottom tap, clockwise circle, counter-clockwise circle', () => {
    expect(GESTURES.map((g) => g.id)).toEqual(['tapTop', 'tapBottom', 'circleClockwise', 'circleCounterclockwise']);
  });

  it('confirms each success by voice and with that gesture\'s own haptic, then moves to the next step', () => {
    const { results, result } = run(GESTURES.map((g) => gesture(g.id)));
    GESTURES.forEach((g, i) => {
      expect(results[i]?.feedback?.haptic).toBe(g.haptic);
      if (i === GESTURES.length - 1) expect(results[i]?.feedback?.text).toMatch(/^Got it\. That's all 4\./);
      else expect(results[i]?.feedback?.text).toContain(`Got it. In your feed, that will ${g.action}.`);
      expect(results[results.length - 1]?.feedback?.text).toContain(`to ${g.action}.`);
      if (i < GESTURES.length - 1) expect(results[i]?.feedback?.text).toContain(`Step ${i + 2} of 4. ${GESTURES[i + 1].instruction}`);
    });
    expect(results.map((r) => r?.feedback?.haptic)).toEqual(['previous', 'next', 'agentAwake', 'agentAsleep']);
    expect(result.state.phase).toBe('complete');
    expect(result.feedback?.text).toContain('Tap anywhere to continue.');
    expect(result.feedback?.text).toContain('Gesture help action');
  });

  it('names the wrong half and asks again without advancing', () => {
    const { result } = run([gesture('tapBottom')]);
    expect(result.state).toMatchObject({ phase: 'practicing', step: 0, misses: 1 });
    expect(result.feedback).toEqual({ text: `That was a tap on the bottom half. ${GESTURES[0].retry}`, haptic: 'edge' });
    const second = run([gesture('tapTop'), gesture('tapTop')]).result;
    expect(second.state.step).toBe(1);
    expect(second.feedback?.text).toBe(`That was a tap on the top half. ${GESTURES[1].retry}`);
  });

  it('tells a tap step that the finger slid, and a circle step that a stroke was too small or did not register', () => {
    expect(run([stroke('swipeUp')]).result.feedback?.text).toBe(`Your finger slid, so that did not count as a tap. ${GESTURES[0].retry}`);
    const toCircle = [gesture('tapTop'), gesture('tapBottom')];
    expect(run([...toCircle, stroke('small')]).result.feedback?.text).toBe(`That was too small to count. ${GESTURES[2].retry}`);
    expect(run([...toCircle, stroke('curve')]).result.feedback?.text).toBe(`That did not register. ${GESTURES[2].retry}`);
    expect(run([...toCircle, gesture('tapTop')]).result.feedback?.text).toBe(`That was a tap on the top half. ${GESTURES[2].retry}`);
  });

  it('names a circle drawn the wrong way round', () => {
    const toCw = [gesture('tapTop'), gesture('tapBottom')];
    expect(run([...toCw, gesture('circleCounterclockwise')]).result.feedback?.text).toBe(`That was a counter-clockwise circle. ${GESTURES[2].retry}`);
    expect(run([...toCw, gesture('circleClockwise'), gesture('circleClockwise')]).result.feedback?.text).toBe(`That was a clockwise circle. ${GESTURES[3].retry}`);
  });

  it('never locks the user out, adds a tip every few misses, and still accepts the right gesture', () => {
    const misses = Array.from({ length: 12 }, () => stroke('curve'));
    const { results, result } = run([gesture('tapTop'), gesture('tapBottom'), ...misses, gesture('circleClockwise')]);
    const missResults = results.slice(2, 14);
    missResults.forEach((r, i) => {
      expect(r?.state.phase).toBe('practicing');
      expect(r?.feedback?.text.includes(GESTURES[2].tip)).toBe((i + 1) % TIP_EVERY === 0);
    });
    expect(missResults[11]?.state.misses).toBe(12);
    expect(result.state).toMatchObject({ phase: 'practicing', step: 3, misses: 0 });
  });

  it('ignores input that lands while the last step is settling, so a double tap counts once', () => {
    const first = practiceReducer(startPractice(0).state, { type: 'input', input: gesture('tapTop'), at: 100 })!;
    expect(first.state.step).toBe(1);
    expect(practiceReducer(first.state, { type: 'input', input: gesture('tapTop'), at: 100 + SETTLE_MS - 1 })).toBeNull();
    expect(practiceReducer(first.state, { type: 'input', input: gesture('tapTop'), at: 100 + SETTLE_MS })?.state.misses).toBe(1);
  });

  it('can be skipped at any step, including after it is complete, and does nothing once closed', () => {
    for (let done = 0; done <= GESTURES.length; done += 1) {
      const { result } = run(GESTURES.slice(0, done).map((g) => gesture(g.id)));
      const skipped = practiceReducer(result.state, { type: 'skip' });
      expect(skipped).toEqual({ state: { ...result.state, phase: 'closed' }, feedback: null });
      expect(practiceReducer(skipped!.state, { type: 'skip' })).toBeNull();
      expect(practiceReducer(skipped!.state, { type: 'repeat' })).toBeNull();
      expect(practiceReducer(skipped!.state, { type: 'input', input: gesture('tapTop'), at: 1e9 })).toBeNull();
    }
  });

  it('repeats the current instruction, or the summary once complete, without changing state', () => {
    const start = startPractice(0).state;
    expect(practiceReducer(start, { type: 'repeat' })).toEqual({ state: start, feedback: { text: `Step 1 of 4. ${GESTURES[0].instruction}`, haptic: null } });
    const { result } = run(GESTURES.map((g) => gesture(g.id)));
    expect(practiceReducer(result.state, { type: 'repeat' })?.feedback?.text).toMatch(/^That's all 4\./);
  });

  it('closes on any tap or circle after completion, but not on a stroke it did not recognize', () => {
    const { result, at } = run(GESTURES.map((g) => gesture(g.id)));
    const later = at + SETTLE_MS;
    expect(practiceReducer(result.state, { type: 'input', input: stroke('curve'), at: later })).toBeNull();
    expect(practiceReducer(result.state, { type: 'input', input: gesture('tapBottom'), at: later })?.state.phase).toBe('closed');
    expect(practiceReducer(result.state, { type: 'input', input: gesture('circleClockwise'), at: later })?.state.phase).toBe('closed');
  });

  it('replays from the first step with a fresh start', () => {
    const { result } = run(GESTURES.map((g) => gesture(g.id)));
    expect(result.state.phase).toBe('complete');
    const replay = startPractice(5000);
    expect(replay.state).toEqual({ phase: 'practicing', step: 0, misses: 0, readyAt: 5000 });
    expect(practiceReducer(replay.state, { type: 'input', input: gesture('tapTop'), at: 5000 })?.state.step).toBe(1);
  });

  it('keeps every message short enough to fit the on-screen caption at the default text size', () => {
    const texts = [startPractice(0).feedback!.text];
    GESTURES.forEach((expected, step) => {
      const at = GESTURES.slice(0, step).map((g) => gesture(g.id));
      const inputs: PracticeInput[] = [...GESTURES.map((g) => gesture(g.id)), stroke('curve'), stroke('small'), stroke('swipeUp')];
      for (const input of inputs) {
        const third = run([...at, input, input, input]).result.feedback?.text;
        if (third) texts.push(third);
      }
      texts.push(run(at).result.feedback!.text);
      if (step === GESTURES.length - 1) texts.push(run([...at, gesture(expected.id)]).result.feedback!.text);
    });
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(CAPTION_BUDGET);
  });

  it('teaches whatever gesture list it is given', () => {
    const custom = [{ ...GESTURES[1], title: 'Swipe right', action: 'move on' }, GESTURES[3]];
    const start = startPractice(0, custom);
    expect(start.feedback?.text).toContain("Let's practice 2 gestures");
    expect(start.feedback?.text).toContain(`Step 1 of 2. ${custom[0].instruction}`);
    const { result } = run([gesture('tapBottom'), gesture('circleCounterclockwise')], custom);
    expect(result.state.phase).toBe('complete');
    expect(result.feedback?.text).toContain("That's all 2. Swipe right to move on.");
  });
});
