// Quick yes-or-no checks on a sampled frame (OpenAI's Decisions API through convex/look.ts), turned into cues.
// They run only while the user has asked about something specific, about once a second for at most questionMs,
// and once on the photo just taken. Pure, so it is unit tested.

export type Edge = 'none' | 'left' | 'right' | 'top' | 'bottom' | 'several';

export type DecisionAnswer = { inView: number | null; cutOff: Edge | null; tooDark: number | null; tooBlurry: number | null };

export const CHECKS = {
  intervalMs: 1000,
  questionMs: 45_000,
  yes: 0.6,
  no: 0.3,
};

// The user's words, as the app says them back: "is my dog in the picture" -> "your dog".
export function heardAs(subject: string): string {
  const swapped = subject
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/\b(my|mine|me|i|myself)\b/gi, (word) => ({ my: 'your', mine: 'yours', me: 'you', i: 'you', myself: 'yourself' })[word.toLowerCase()] ?? word);
  return swapped || 'it';
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The phone mirrors front-camera frames before they are checked, so an edge is the user's own left or right for
// both cameras, and the fix is always to move towards the cut-off side.
const EDGE_FIX: Record<'left' | 'right' | 'top' | 'bottom', string> = {
  left: 'on the left. Move left.',
  right: 'on the right. Move right.',
  top: 'at the top. Tilt up.',
  bottom: 'at the bottom. Tilt down.',
};

// The most important thing a check found about the subject, or null when there is nothing new to say.
export function subjectCue(answer: DecisionAnswer, subject: string): string | null {
  const thing = heardAs(subject);
  if (answer.inView === null) return null;
  if (answer.inView < CHECKS.no) return `I don't see ${thing} yet. Move the phone slowly.`;
  if (answer.inView < CHECKS.yes) return null;
  if (answer.cutOff === 'several') return `${capitalized(thing)} doesn't fit. Move farther away.`;
  if (answer.cutOff && answer.cutOff !== 'none') return `Part of ${thing} is cut off ${EDGE_FIX[answer.cutOff]}`;
  return `${capitalized(thing)} is in the picture.`;
}

// Too dark or too blurred to post, from the same answer.
export function qualityCue(answer: DecisionAnswer): string | null {
  const dark = (answer.tooDark ?? 0) >= CHECKS.yes;
  const blurred = (answer.tooBlurry ?? 0) >= CHECKS.yes;
  if (dark && blurred) return "It's too dark and blurred to post.";
  if (dark) return "It's too dark to post. Find more light.";
  if (blurred) return "It's too blurred to post. Hold the phone steadier.";
  return null;
}
