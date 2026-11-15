import { authorName, buildPostScript, type DescriptionParts, type DetailLevel } from '@/narration/buildNarration';
import type { Post } from '@/social/types';

import type { NarrationSettings } from './settings';

// The one seam between the agent and narration: every script the agent has spoken comes from the feed's own
// builder (src/narration/buildNarration.ts), so the agent reads a post exactly as scrolling does.

export type ReadMode = 'full' | 'brief' | 'exact' | 'hashtags' | 'picture';

export const detailFor = (mode: ReadMode, settings: NarrationSettings): DetailLevel => (mode === 'picture' || settings.pictureDetail === 'long' ? 'detailed' : 'standard');

// Brief, exact and hashtag readings never include descriptions, so they never ask for one.
export const usesDescriptions = (mode: ReadMode) => mode === 'full' || mode === 'picture';

export function narratePost(post: Post, mode: ReadMode, settings: NarrationSettings, { now = new Date(), parts = null }: { now?: Date; parts?: DescriptionParts | null } = {}): string {
  const options = { now, parts, skipHashtags: settings.skipHashtags };
  switch (mode) {
    case 'full':
    case 'brief':
    case 'hashtags':
      return buildPostScript(post, { ...options, mode });
    case 'exact':
      return post.text.trim() ? `${authorName(post)} wrote, word for word: ${post.text.trim()}` : `${authorName(post)}'s post has no text.`;
    case 'picture':
      return buildPostScript(post, { ...options, mode: 'detailedImage' });
  }
}

export function narrateForFeed(post: Post, settings: NarrationSettings, parts: DescriptionParts | null, now = new Date()): string {
  return narratePost(post, settings.mode, settings, { now, parts });
}
