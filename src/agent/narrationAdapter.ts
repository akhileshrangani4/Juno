import {
  authorName,
  buildPostScript,
  translatedText,
  translationMessages,
  type DescriptionParts,
  type DetailLevel,
  type TranslationState,
} from '@/narration/buildNarration';
import { languageName } from '@/narration/language';
import type { Post } from '@/social/types';

import type { NarrationSettings } from './settings';

// The one seam between the agent and narration: every script the agent has spoken comes from the feed's own
// builder (src/narration/buildNarration.ts), so the agent reads a post exactly as scrolling does.

export type ReadMode = 'full' | 'brief' | 'exact' | 'hashtags' | 'picture' | 'translation';

export const detailFor = (mode: ReadMode, settings: NarrationSettings): DetailLevel => (mode === 'picture' || settings.pictureDetail === 'long' ? 'detailed' : 'standard');

// Readings with picture descriptions ask for them; every reading of the post's text asks for a translation when
// the text may need one (src/narration/descriptions.ts decides).
export const usesDescriptions = (mode: ReadMode) => mode === 'full' || mode === 'picture' || mode === 'translation';
export const usesTranslation = (mode: ReadMode) => mode !== 'hashtags' && mode !== 'picture';

type ReadOptions = { now?: Date; parts?: DescriptionParts | null; translation?: TranslationState };

export function narratePost(post: Post, mode: ReadMode, settings: NarrationSettings, { now = new Date(), parts = null, translation = null }: ReadOptions = {}): string {
  const options = { now, parts, skipHashtags: settings.skipHashtags, translation };
  switch (mode) {
    case 'full':
    case 'brief':
    case 'hashtags':
      return buildPostScript(post, { ...options, mode });
    case 'translation':
      return buildPostScript(post, { ...options, mode: 'full' });
    case 'exact': {
      // The agent's voice speaks only the user's language, so another language's words are never read in it. The
      // phone's own voice for that language can read them once the agent is asleep.
      const translated = translatedText(parts?.translation);
      const language = parts?.translation?.language ?? parts?.untranslatedLanguage;
      if (translated) return `${authorName(post)} wrote this in ${languageName(language!)}. ${cannotPronounceInCall(language!)} ${translated} ${originalAfterCall}`;
      if (language) return `${authorName(post)}. ${translationMessages.failedIn(language)} ${originalAfterCall}`;
      if (translation) return `${authorName(post)}. ${translationMessages[translation]} ${originalAfterCall}`;
      return post.text.trim() ? `${authorName(post)} wrote, word for word: ${post.text.trim()}` : `${authorName(post)}'s post has no text.`;
    }
    case 'picture':
      return buildPostScript(post, { ...options, mode: 'detailedImage' });
  }
}

export const cannotPronounceInCall = (language: string) => `I can't pronounce ${languageName(language)} well, so here is the translation.`;
export const originalAfterCall = 'To hear the original, draw a circle counter-clockwise to put me to sleep, then choose Read exactly from the VoiceOver actions.';

export function narrateForFeed(post: Post, settings: NarrationSettings, parts: DescriptionParts | null, now = new Date(), translation: TranslationState = null): string {
  return narratePost(post, settings.mode, settings, { now, parts, translation });
}
