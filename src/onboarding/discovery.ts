import { GESTURES, type Cue, type FeedMode, type GestureId, type TaughtGesture } from './gestures';
import type { StrokeKind } from './strokes';

export type DiscoveryProgress = { sessions: number; learned: GestureId[] };
export type DiscoveryState = {
  active: boolean;
  learned: GestureId[];
  streak: GestureId[];
  speaking: boolean;
  quietSince: number;
  idleHinted: boolean;
  pending: GestureId | null;
};
export type DiscoveryEvent =
  | { type: 'recognized'; gesture: GestureId; at: number }
  | { type: 'unrecognized'; stroke: StrokeKind; mode: FeedMode; narrating: boolean; at: number }
  | { type: 'quiet'; at: number }
  | { type: 'tick'; mode: FeedMode; narrating: boolean; at: number }
  | { type: 'scrolling'; at: number }
  | { type: 'activity'; at: number };
export type DiscoveryResult = { state: DiscoveryState; hint: TaughtGesture | null };

export const FIRST_SESSIONS = 5;
export const STROKES_BEFORE_HINT = 3;
export const IDLE_MS = 20_000;

const allLearned = (learned: GestureId[], gestures: TaughtGesture[]) => gestures.every((gesture) => learned.includes(gesture.id));

export function startDiscovery(progress: DiscoveryProgress, gestures: TaughtGesture[] = GESTURES): DiscoveryState {
  return {
    active: progress.sessions <= FIRST_SESSIONS && !allLearned(progress.learned, gestures),
    learned: progress.learned,
    streak: [],
    speaking: true,
    quietSince: 0,
    idleHinted: false,
    pending: null,
  };
}

export function likelyGesture(cue: Cue, mode: FeedMode, learned: GestureId[], gestures: TaughtGesture[] = GESTURES): TaughtGesture | null {
  const available = gestures.filter((gesture) => gesture.modes.includes(mode));
  if (cue === 'idle') {
    const unlearned = available.filter((gesture) => !learned.includes(gesture.id));
    return unlearned.find((gesture) => gesture.cues.includes('idle')) ?? unlearned[0] ?? null;
  }
  return available.find((gesture) => gesture.cues.includes(cue)) ?? null;
}

function mostFrequent(ids: GestureId[]): GestureId {
  let best = ids[ids.length - 1];
  let bestCount = 0;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const count = ids.filter((id) => id === ids[i]).length;
    if (count > bestCount) {
      best = ids[i];
      bestCount = count;
    }
  }
  return best;
}

export function discoveryReducer(state: DiscoveryState, event: DiscoveryEvent, gestures: TaughtGesture[] = GESTURES): DiscoveryResult {
  const none = (next: DiscoveryState): DiscoveryResult => ({ state: next, hint: null });
  const find = (id: GestureId) => gestures.find((gesture) => gesture.id === id) ?? null;
  switch (event.type) {
    case 'recognized': {
      const learned = state.learned.includes(event.gesture) ? state.learned : [...state.learned, event.gesture];
      return none({ ...state, learned, active: state.active && !allLearned(learned, gestures), streak: [], speaking: true, idleHinted: false, pending: null });
    }
    case 'activity':
      return none({ ...state, speaking: true, idleHinted: false, pending: null });
    case 'unrecognized': {
      if (!state.active || event.mode === 'agent') return none(state);
      const guess = likelyGesture(event.stroke, event.mode, state.learned, gestures);
      const streak = guess ? [...state.streak, guess.id] : state.streak;
      const next = { ...state, streak, quietSince: event.at, idleHinted: false };
      if (streak.length < STROKES_BEFORE_HINT) return none(next);
      const wanted = mostFrequent(streak);
      if (state.speaking || event.narrating) return none({ ...next, streak: [], pending: wanted });
      return { state: { ...next, streak: [], speaking: true }, hint: find(wanted) };
    }
    case 'scrolling':
      return none({ ...state, streak: [], speaking: true, quietSince: event.at, idleHinted: false, pending: null });
    case 'quiet': {
      const next = { ...state, speaking: false, quietSince: event.at, pending: null };
      if (!state.active || !state.pending) return none(next);
      return { state: { ...next, speaking: true }, hint: find(state.pending) };
    }
    case 'tick': {
      if (!state.active || event.mode === 'agent' || state.speaking || event.narrating || state.idleHinted || event.at - state.quietSince < IDLE_MS) return none(state);
      const hint = likelyGesture('idle', event.mode, state.learned, gestures);
      return { state: { ...state, idleHinted: true, speaking: hint !== null }, hint };
    }
  }
}
