import { ALL_GESTURES, type FeedMode, type Gesture, type GestureId } from './gestures';

export type TipProgress = { introduced: GestureId[]; tipsOff: boolean; lastTipSession: number };
export type TipState = TipProgress & { session: number; pending: { id: GestureId; until: number } | null };
export type TipResult = { state: TipState; tip: Gesture | null };

// A tip waits this long for a quiet moment between posts; if none comes it is dropped and offered again later.
export const TIP_WAIT_MS = 15_000;

const tipGesture = (id: GestureId) => ALL_GESTURES.find((gesture) => gesture.id === id && gesture.stage === 'tip') ?? null;

export const startTips = (progress: TipProgress, session: number): TipState => ({ ...progress, session, pending: null });

// Queues the first candidate not yet introduced, at most one tip per session and none once tips are turned off.
export function offerTip(state: TipState, candidates: GestureId[], at: number): TipState {
  if (state.tipsOff || state.pending || state.lastTipSession === state.session) return state;
  const id = candidates.find((candidate) => tipGesture(candidate) && !state.introduced.includes(candidate));
  return id ? { ...state, pending: { id, until: at + TIP_WAIT_MS } } : state;
}

// Called when the device is quiet. Plays the queued tip unless something is still being said; drops it once it has
// waited too long or the agent is awake, because the call owns the audio.
export function releaseTip(state: TipState, { at, mode, narrating }: { at: number; mode: FeedMode; narrating: boolean }): TipResult {
  const { pending } = state;
  if (!pending) return { state, tip: null };
  if (state.tipsOff || mode === 'agent' || at > pending.until) return { state: { ...state, pending: null }, tip: null };
  if (narrating) return { state, tip: null };
  return {
    state: { ...state, pending: null, introduced: [...state.introduced, pending.id], lastTipSession: state.session },
    tip: tipGesture(pending.id),
  };
}

export const tipsOff = (state: TipState): TipState => ({ ...state, tipsOff: true, pending: null });

// Tips play again from the start, each when it is next useful, still one per session.
export const tipsAgain = (state: TipState): TipState => ({ ...state, tipsOff: false, introduced: [], lastTipSession: 0, pending: null });

export const tipMessages = {
  off: 'Tips are off. Gesture help still lists the gestures you know.',
  again: "Tips are back on. You'll hear each one again when it's useful.",
};
