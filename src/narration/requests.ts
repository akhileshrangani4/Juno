import type { Post } from '@/social/types';

import { messages, type DetailLevel, type NarrationMode } from './buildNarration';
import { deviceLanguages } from './deviceLanguages';
import { languageName } from './language';
import { activePostNarrator, narrationPreferences } from './postNarration';
import { effectiveLanguages, RATE_LIMITS, stepRate, type NarrationPreferences } from './preferences';

export type { NarrationMode } from './buildNarration';

// The seam the voice agent (src/agent) drives. "Read it exactly" is verbatim, "read the hashtags" is
// hashtags, "describe the picture in more detail" is detailedImage; full and brief follow the standing mode.
// Returns the script that is now being spoken, or null when no feed is on screen.
export function narratePost(post: Post, mode?: NarrationMode): string | null {
  return activePostNarrator()?.focus(post, { mode }) ?? null;
}

export function stopNarration(): void {
  activePostNarrator()?.stop();
}

export const getNarrationPreferences = (): NarrationPreferences => narrationPreferences.get();

export const setNarrationMode = (mode: 'full' | 'brief') => narrationPreferences.update({ mode });
export const setSpeechRate = (rate: number) => narrationPreferences.update({ rate });
export const setSkipHashtags = (skipHashtags: boolean) => narrationPreferences.update({ skipHashtags });
export const setDefaultDetail = (detail: DetailLevel) => narrationPreferences.update({ detail });
export const setEarcons = (earcons: boolean) => narrationPreferences.update({ earcons });

export type NarrationAction = 'narrationMode' | 'faster' | 'slower' | 'speechRate' | 'earcons' | 'translation';

// With a screen reader on, the screen reader speaks at its own rate and the app's rate never applies, so
// "Speak faster" and "Speak slower" give way to one "Speech speed" action that says so.
export function narrationActions(prefs: NarrationPreferences, screenReader: boolean): { name: NarrationAction; label: string }[] {
  const rate: { name: NarrationAction; label: string }[] = screenReader
    ? [{ name: 'speechRate', label: 'Speech speed' }]
    : [
        { name: 'faster', label: 'Speak faster' },
        { name: 'slower', label: 'Speak slower' },
      ];
  return [
    { name: 'narrationMode', label: prefs.mode === 'brief' ? 'Full narration' : 'Brief narration' },
    ...rate,
    { name: 'earcons', label: prefs.earcons ? 'Turn post sounds off' : 'Turn post sounds on' },
    { name: 'translation', label: prefs.translate ? 'Stop translating posts' : 'Translate posts' },
  ];
}

export const isNarrationAction = (name: string): name is NarrationAction => ['narrationMode', 'faster', 'slower', 'speechRate', 'earcons', 'translation'].includes(name);

// Applies a VoiceOver action and returns what to say about it.
export function applyNarrationAction(action: NarrationAction, screenReader: boolean): string {
  const prefs = narrationPreferences.get();
  if (screenReader && (action === 'faster' || action === 'slower')) return messages.screenReaderRate;
  switch (action) {
    case 'speechRate':
      return messages.screenReaderRate;
    case 'narrationMode':
      return setNarrationMode(prefs.mode === 'brief' ? 'full' : 'brief').mode === 'brief' ? messages.briefMode : messages.fullMode;
    case 'earcons':
      return setEarcons(!prefs.earcons).earcons ? messages.earconsOn : messages.earconsOff;
    case 'translation': {
      const languages = effectiveLanguages(narrationPreferences.update({ translate: !prefs.translate }), deviceLanguages());
      return languages ? messages.translationOn(languageName(languages.target)) : messages.translationOff;
    }
    case 'faster':
    case 'slower': {
      const rate = stepRate(prefs.rate, action);
      if (rate === prefs.rate) return action === 'faster' ? messages.fastest(rate) : messages.slowest(rate);
      return messages.rate(setSpeechRate(rate).rate);
    }
  }
}

export { RATE_LIMITS };
