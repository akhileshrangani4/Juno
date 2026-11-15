import { haptic } from '@/feedback/haptics';
import { messages } from '@/narration/buildNarration';
import type { Narrator } from '@/narration/Narrator';

export function playUnrecognizedCue({ narrator, showHint, allowSpeech }: { narrator: Narrator; showHint(): void; allowSpeech(): boolean }): void {
  haptic('unrecognized');
  showHint();
  if (!narrator.speaking() && allowSpeech()) narrator.speak(messages.unrecognized);
}
