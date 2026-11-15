import { classifyStroke as surfaceOutcome } from '@/gestures/stroke';

import {
  discoveryReducer,
  FIRST_SESSIONS,
  IDLE_MS,
  likelyGesture,
  startDiscovery,
  STROKES_BEFORE_HINT,
  type DiscoveryEvent,
  type DiscoveryState,
} from '../discovery';
import { GESTURES, type GestureId } from '../gestures';
import { classifyStroke, type StrokeKind } from '../strokes';

const fresh = (learned: GestureId[] = [], sessions = 1) => startDiscovery({ sessions, learned });

function apply(state: DiscoveryState, events: DiscoveryEvent[]) {
  const hints: (string | null)[] = [];
  for (const event of events) {
    const result = discoveryReducer(state, event);
    state = result.state;
    hints.push(result.hint?.id ?? null);
  }
  return { state, hints };
}

const strokes = (kinds: StrokeKind[], mode: 'scroll' | 'agent' = 'scroll', narrating = false): DiscoveryEvent[] =>
  kinds.map((stroke, i) => ({ type: 'unrecognized', stroke, mode, narrating, at: i * 1000 }));

describe('startDiscovery', () => {
  it('is active only in the first sessions and only until every gesture has been used', () => {
    expect(fresh([], 1).active).toBe(true);
    expect(fresh([], FIRST_SESSIONS).active).toBe(true);
    expect(fresh([], FIRST_SESSIONS + 1).active).toBe(false);
    expect(fresh(['tapTop', 'tapBottom', 'circleClockwise']).active).toBe(true);
    expect(fresh(GESTURES.map((g) => g.id)).active).toBe(false);
  });
});

describe('stuck hint after unrecognized strokes', () => {
  const listening = (learned: GestureId[] = []) => discoveryReducer(fresh(learned), { type: 'quiet', mode: 'scroll', at: 0 }).state;

  it(`hints after ${STROKES_BEFORE_HINT} unrecognized strokes in a row, then starts counting again`, () => {
    const { hints, state } = apply(listening(), strokes(['curve', 'curve', 'curve', 'curve']));
    expect(hints).toEqual([null, null, 'circleClockwise', null]);
    expect(state.streak).toHaveLength(1);
  });

  it('names the gesture the strokes most likely aimed for', () => {
    expect(apply(listening(), strokes(['swipeUp', 'swipeLeft', 'curve'])).hints[2]).toBe('tapBottom');
    expect(apply(listening(), strokes(['swipeDown', 'swipeDown', 'swipeRight'])).hints[2]).toBe('tapTop');
    expect(apply(listening(), strokes(['curve', 'curve', 'swipeUp'])).hints[2]).toBe('circleClockwise');
    expect(apply(listening(), strokes(['swipeUp', 'curve', 'swipeDown'])).hints[2]).toBe('tapTop');
  });

  it('never turns small strokes, which are usually slipped taps, into a circle hint', () => {
    const { hints, state } = apply(listening(), strokes(['small', 'small', 'small', 'small']));
    expect(hints).toEqual([null, null, null, null]);
    expect(state.streak).toEqual([]);
    expect(apply(listening(), strokes(['small', 'swipeUp', 'small', 'swipeUp', 'small'])).hints).toEqual([null, null, null, null, null]);
    expect(likelyGesture('small', 'scroll', [])).toBeNull();
  });

  it('holds a stroke hint until the post being read has finished, instead of cutting it off', () => {
    const { hints } = apply(fresh(), [...strokes(['curve', 'curve', 'curve']), { type: 'quiet', mode: 'scroll', at: 5000 }]);
    expect(hints).toEqual([null, null, null, 'circleClockwise']);
  });

  it('drops a held hint instead of speaking it when the narration ends with the agent awake', () => {
    const { hints } = apply(fresh(), [...strokes(['curve', 'curve', 'curve']), { type: 'quiet', mode: 'agent', at: 5000 }, { type: 'quiet', mode: 'scroll', at: 6000 }]);
    expect(hints).toEqual([null, null, null, null, null]);
  });

  it('holds a stroke hint while the narrator reports it is speaking, even with no event saying a post started', () => {
    const { hints } = apply(listening(), [...strokes(['curve', 'curve', 'curve'], 'scroll', true), { type: 'quiet', mode: 'scroll', at: 5000 }]);
    expect(hints).toEqual([null, null, null, 'circleClockwise']);
  });

  it('never counts a drag that scrolled a long post, because GestureSurface does not report it as unrecognized', () => {
    const drag = Array.from({ length: 31 }, (_, i) => ({ x: 196, y: 620 - i * 10 }));
    expect(surfaceOutcome(drag, true)).toBe('scroll');
    expect(surfaceOutcome(drag, false)).toBe('unrecognized');
    const outcomes = [surfaceOutcome(drag, true), surfaceOutcome(drag, true), surfaceOutcome(drag, true)];
    const events = outcomes.filter((outcome) => outcome === 'unrecognized').map(() => ({ type: 'unrecognized', stroke: classifyStroke(drag), mode: 'scroll', narrating: false, at: 0 }) as DiscoveryEvent);
    const { state, hints } = apply(listening(), events);
    expect(state.streak).toEqual([]);
    expect(hints).toEqual([]);
  });

  it('drops a held stroke hint once the user moves on', () => {
    const viaGesture = apply(fresh(), [...strokes(['curve', 'curve', 'curve']), { type: 'recognized', gesture: 'tapBottom', at: 4000 }, { type: 'quiet', mode: 'scroll', at: 5000 }]);
    expect(viaGesture.hints).toEqual([null, null, null, null, null]);
    const viaAction = apply(fresh(), [...strokes(['curve', 'curve', 'curve']), { type: 'activity', at: 4000 }, { type: 'quiet', mode: 'scroll', at: 5000 }]);
    expect(viaAction.hints).toEqual([null, null, null, null, null]);
  });

  it('resets the streak when a gesture is recognized', () => {
    const { hints } = apply(listening(), [
      ...strokes(['curve', 'curve']),
      { type: 'recognized', gesture: 'tapBottom', at: 2500 },
      { type: 'quiet', mode: 'scroll', at: 2600 },
      ...strokes(['curve', 'curve']),
    ]);
    expect(hints).toEqual([null, null, null, null, null, null]);
  });

  it('stays quiet after the first sessions or once every gesture has been used', () => {
    expect(apply(discoveryReducer(fresh([], FIRST_SESSIONS + 1), { type: 'quiet', mode: 'scroll', at: 0 }).state, strokes(['curve', 'curve', 'curve'])).hints).toEqual([null, null, null]);
    const learnedAll: DiscoveryEvent[] = GESTURES.map((g, i) => ({ type: 'recognized', gesture: g.id, at: i }));
    const { state, hints } = apply(listening(), [...learnedAll, { type: 'quiet', mode: 'scroll', at: 10 }, ...strokes(['curve', 'curve', 'curve'])]);
    expect(state.active).toBe(false);
    expect(hints.every((hint) => hint === null)).toBe(true);
  });

  it('does not run while the agent is awake, so a stroke there neither hints nor counts', () => {
    const { state, hints } = apply(listening(), strokes(['curve', 'curve', 'curve', 'curve'], 'agent'));
    expect(hints).toEqual([null, null, null, null]);
    expect(state.streak).toEqual([]);
  });

  it('starts the stroke count over when the user returns to scrolling', () => {
    const { hints } = apply(listening(), [
      ...strokes(['curve', 'curve']),
      { type: 'scrolling', at: 2500 },
      { type: 'quiet', mode: 'scroll', at: 2600 },
      ...strokes(['curve', 'curve']),
      { type: 'unrecognized', stroke: 'curve', mode: 'scroll', narrating: false, at: 9000 },
    ]);
    expect(hints).toEqual([null, null, null, null, null, null, 'circleClockwise']);
  });

  it('records each recognized gesture once', () => {
    const { state } = apply(fresh(), [
      { type: 'recognized', gesture: 'tapBottom', at: 0 },
      { type: 'recognized', gesture: 'tapBottom', at: 1 },
      { type: 'recognized', gesture: 'tapTop', at: 2 },
    ]);
    expect(state.learned).toEqual(['tapBottom', 'tapTop']);
  });
});

describe('stuck hint after a long idle', () => {
  const quiet = (at: number): DiscoveryEvent => ({ type: 'quiet', mode: 'scroll', at });
  const tick = (at: number, mode: 'scroll' | 'agent' = 'scroll', narrating = false): DiscoveryEvent => ({ type: 'tick', mode, narrating, at });

  it('hints once the narration has been quiet for the idle time, and only once per idle stretch', () => {
    const { hints } = apply(fresh(), [quiet(0), tick(IDLE_MS - 1), tick(IDLE_MS), tick(IDLE_MS * 3)]);
    expect(hints).toEqual([null, null, 'tapBottom', null]);
  });

  it('never fires while a post is still being read', () => {
    expect(apply(fresh(), [tick(IDLE_MS * 10)]).hints).toEqual([null]);
    const { hints } = apply(fresh(), [quiet(0), { type: 'recognized', gesture: 'tapBottom', at: 1000 }, tick(IDLE_MS * 2)]);
    expect(hints[2]).toBeNull();
  });

  it('re-arms after the user touches the screen again', () => {
    const { hints } = apply(fresh(), [
      quiet(0),
      tick(IDLE_MS),
      quiet(IDLE_MS + 5000),
      tick(IDLE_MS * 2 + 5000),
      { type: 'unrecognized', stroke: 'swipeUp', mode: 'scroll', narrating: false, at: IDLE_MS * 3 },
      tick(IDLE_MS * 4 + 1),
    ]);
    expect(hints).toEqual([null, 'tapBottom', null, null, null, 'tapBottom']);
  });

  it('treats a post started from the VoiceOver rotor, magic tap or escape as narration, with no gesture before it', () => {
    const { hints } = apply(fresh(), [
      quiet(0),
      { type: 'activity', at: 15_000 },
      tick(IDLE_MS + 1000),
      tick(IDLE_MS * 3),
      quiet(IDLE_MS * 3 + 500),
      tick(IDLE_MS * 4),
      tick(IDLE_MS * 4 + 500),
    ]);
    expect(hints).toEqual([null, null, null, null, null, null, 'tapBottom']);
  });

  it('never starts an idle hint while the narrator reports it is speaking', () => {
    const { hints } = apply(fresh(), [quiet(0), tick(IDLE_MS, 'scroll', true), tick(IDLE_MS * 2, 'scroll', true), tick(IDLE_MS * 2 + 5000)]);
    expect(hints).toEqual([null, null, null, 'tapBottom']);
  });

  it('re-arms the idle hint after accessibility activity', () => {
    const { hints } = apply(fresh(), [quiet(0), tick(IDLE_MS), { type: 'activity', at: IDLE_MS + 100 }, quiet(IDLE_MS + 9000), tick(IDLE_MS * 2 + 9000)]);
    expect(hints).toEqual([null, 'tapBottom', null, null, 'tapBottom']);
  });

  it('names the next gesture the user has not used yet, in the current mode', () => {
    expect(likelyGesture('idle', 'scroll', [])?.id).toBe('tapBottom');
    expect(likelyGesture('idle', 'scroll', ['tapBottom'])?.id).toBe('tapTop');
    expect(likelyGesture('idle', 'scroll', ['tapBottom', 'tapTop'])?.id).toBe('circleClockwise');
    expect(likelyGesture('idle', 'agent', [])?.id).toBe('circleCounterclockwise');
    expect(likelyGesture('idle', 'scroll', ['tapBottom', 'tapTop', 'circleClockwise'])).toBeNull();
  });

  it('stays quiet while the agent is awake', () => {
    expect(apply(fresh(), [quiet(0), tick(IDLE_MS, 'agent'), tick(IDLE_MS * 3, 'agent')]).hints).toEqual([null, null, null]);
  });

  it('restarts the idle clock and re-arms the idle hint when the user returns to scrolling', () => {
    const { hints } = apply(fresh(), [
      quiet(0),
      tick(IDLE_MS),
      { type: 'scrolling', at: IDLE_MS + 1000 },
      tick(IDLE_MS * 3),
      quiet(IDLE_MS * 3),
      tick(IDLE_MS * 4 - 1),
      tick(IDLE_MS * 4),
    ]);
    expect(hints).toEqual([null, 'tapBottom', null, null, null, null, 'tapBottom']);
  });

  it('does not hint about gestures already used', () => {
    const { hints } = apply(fresh(['tapBottom', 'tapTop', 'circleClockwise']), [quiet(0), tick(IDLE_MS)]);
    expect(hints).toEqual([null, null]);
  });
});
