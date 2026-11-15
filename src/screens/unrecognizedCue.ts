import { haptic } from '@/feedback/haptics';
import { messages } from '@/narration/buildNarration';
import type { Narrator } from '@/narration/Narrator';

// speaking() is the post narrator's, so the earcon before a post and a description queued after it count as
// speech: the cue is never spoken over them, and the haptic and on-screen hint still come at once.
export function playUnrecognizedCue({
  narrator,
  speaking,
  showHint,
  allowSpeech,
}: {
  narrator: Narrator;
  speaking(): boolean;
  showHint(): void;
  allowSpeech(): boolean;
}): void {
  haptic('unrecognized');
  showHint();
  if (!speaking() && allowSpeech()) narrator.speak(messages.unrecognized);
}
