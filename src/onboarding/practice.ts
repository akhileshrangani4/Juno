import type { HapticEvent } from '@/feedback/haptics';

import { GESTURES, gestureSummary, type GestureId, type TaughtGesture } from './gestures';
import type { StrokeKind } from './strokes';

export type PracticeInput = { kind: 'gesture'; gesture: GestureId } | { kind: 'stroke'; stroke: StrokeKind };
export type PracticeEvent = { type: 'input'; input: PracticeInput; at: number } | { type: 'repeat' } | { type: 'skip' };
export type PracticeState = { phase: 'practicing' | 'complete' | 'closed'; step: number; misses: number; readyAt: number };
export type Feedback = { text: string; haptic: HapticEvent | null };
export type PracticeResult = { state: PracticeState; feedback: Feedback | null };

export const SETTLE_MS = 700;
export const TIP_EVERY = 3;

const stepText = (step: number, gestures: TaughtGesture[]) => `Step ${step + 1} of ${gestures.length}. ${gestures[step].instruction}`;

export const completeText = (gestures: TaughtGesture[] = GESTURES) =>
  `That's all ${gestures.length}. ${gestureSummary(gestures)} The Gesture help action on the feed repeats this. Tap anywhere to continue.`;

export function startPractice(at: number, gestures: TaughtGesture[] = GESTURES): PracticeResult {
  return {
    state: { phase: 'practicing', step: 0, misses: 0, readyAt: at },
    feedback: {
      text: `Let's practice ${gestures.length} gestures, one at a time. To skip, press Skip practice at the bottom right, choose it from the VoiceOver actions, or with Voice Control, say: tap Skip practice. ${stepText(0, gestures)}`,
      haptic: null,
    },
  };
}

function missText(expected: TaughtGesture, input: PracticeInput, gestures: TaughtGesture[]): string {
  if (input.kind === 'gesture') {
    const made = gestures.find((gesture) => gesture.id === input.gesture);
    return made ? `That was ${made.name}.` : 'That did not register.';
  }
  if (expected.kind === 'tap') return 'Your finger slid, so that did not count as a tap.';
  return input.stroke === 'small' ? 'That was too small to count.' : 'That did not register.';
}

export function practiceReducer(state: PracticeState, event: PracticeEvent, gestures: TaughtGesture[] = GESTURES): PracticeResult | null {
  if (state.phase === 'closed') return null;
  switch (event.type) {
    case 'skip':
      return { state: { ...state, phase: 'closed' }, feedback: null };
    case 'repeat':
      return { state, feedback: { text: state.phase === 'complete' ? completeText(gestures) : stepText(state.step, gestures), haptic: null } };
    case 'input': {
      const { input, at } = event;
      if (at < state.readyAt) return null;
      if (state.phase === 'complete') return input.kind === 'gesture' ? { state: { ...state, phase: 'closed' }, feedback: null } : null;
      const expected = gestures[state.step];
      const readyAt = at + SETTLE_MS;
      if (input.kind === 'gesture' && input.gesture === expected.id) {
        const step = state.step + 1;
        const done = step === gestures.length;
        return {
          state: { phase: done ? 'complete' : 'practicing', step, misses: 0, readyAt },
          feedback: { text: done ? `Got it. ${completeText(gestures)}` : `Got it. In your feed, that will ${expected.action}. ${stepText(step, gestures)}`, haptic: expected.haptic },
        };
      }
      const misses = state.misses + 1;
      const text = [missText(expected, input, gestures), expected.retry, misses % TIP_EVERY === 0 ? expected.tip : null].filter(Boolean).join(' ');
      return { state: { ...state, misses, readyAt }, feedback: { text, haptic: 'edge' } };
    }
  }
}
