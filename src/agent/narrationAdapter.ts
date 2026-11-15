import { authorName, buildPostNarration, formatAge, speakableText } from '@/narration/buildNarration';
import type { Post, PostMedia } from '@/social/types';

import type { NarrationSettings } from './settings';

// The one seam between the agent and narration. It wraps buildNarration from PR #1 for now; when the
// richer narration module from AKH-4 lands in src/narration, whichever branch merges second points
// these functions at it and the agent keeps calling the same names.

export type ReadMode = 'full' | 'brief' | 'exact' | 'hashtags' | 'picture';

const HASHTAG = /(^|\s)#[^\s#.,!?;:()"']+/g;

export function hashtagsOf(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((match) => match[0].trim());
}

export function withoutHashtags(text: string): string {
  return text.replace(HASHTAG, '$1').replace(/\s+/g, ' ').trim();
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

function firstLine(text: string): string {
  const spoken = speakableText(text);
  const match = spoken.match(/^.*?[.!?…](\s|$)/);
  return (match ? match[0] : spoken).trim();
}

function mediaSummary(media: PostMedia[]): string | null {
  const parts = media.map((item) => {
    switch (item.kind) {
      case 'images':
        return item.images.length === 1 ? 'an image' : `${item.images.length} images`;
      case 'video':
        return 'a video';
      case 'link':
        return 'a link';
      case 'quote':
        return `a quote of ${item.authorName}`;
    }
  });
  return parts.length ? `It has ${parts.join(' and ')}.` : null;
}

const firstSentence = (text: string) => text.split(/(?<=[.!?…])\s/)[0];

function shortenAlts(post: Post): Post {
  return {
    ...post,
    media: post.media.map((media) => {
      if (media.kind === 'images') return { ...media, images: media.images.map((image) => ({ ...image, alt: image.alt && firstSentence(image.alt) })) };
      if (media.kind === 'video') return { ...media, alt: media.alt && firstSentence(media.alt) };
      return media;
    }),
  };
}

function describePictures(post: Post, description: string | null): string {
  const lines: string[] = [];
  for (const media of post.media) {
    if (media.kind === 'images') {
      media.images.forEach((image, i) => {
        const label = media.images.length === 1 ? 'The image' : `Image ${i + 1}`;
        const text = image.alt ?? (media.images.length === 1 ? description : null);
        lines.push(text ? `${label}: ${sentence(text)}` : `${label} has no description yet.`);
      });
    } else if (media.kind === 'video') {
      const text = media.alt ?? description;
      lines.push(text ? `The video: ${sentence(text)}` : 'The video has no description yet.');
    }
  }
  return lines.length ? lines.join(' ') : 'This post has no pictures or video.';
}

export function narratePost(
  post: Post,
  mode: ReadMode,
  settings: NarrationSettings,
  { now = new Date(), description = null }: { now?: Date; description?: string | null } = {},
): string {
  switch (mode) {
    case 'full': {
      const text = settings.skipHashtags ? withoutHashtags(post.text) : post.text;
      const shaped = settings.pictureDetail === 'short' ? shortenAlts({ ...post, text }) : { ...post, text };
      return buildPostNarration(shaped, now, description && settings.pictureDetail === 'short' ? firstSentence(description) : description);
    }
    case 'brief': {
      const text = settings.skipHashtags ? withoutHashtags(post.text) : post.text;
      return [`${authorName(post)}, ${formatAge(post.createdAt, now)}.`, text ? sentence(firstLine(text)) : null, mediaSummary(post.media)]
        .filter(Boolean)
        .join(' ');
    }
    case 'exact':
      return post.text ? `${authorName(post)} wrote, word for word: ${post.text}` : `${authorName(post)}'s post has no text.`;
    case 'hashtags': {
      const tags = hashtagsOf(post.text);
      if (!tags.length) return 'This post has no hashtags.';
      return `This post has ${tags.length === 1 ? 'one hashtag' : `${tags.length} hashtags`}: ${tags.join(', ')}.`;
    }
    case 'picture':
      return describePictures(post, description);
  }
}

export function narrateForFeed(post: Post, settings: NarrationSettings, description: string | null, now = new Date()): string {
  return narratePost(post, settings.mode, settings, { now, description });
}

export function postHasUndescribedMedia(post: Post): boolean {
  return post.media.some((media) => (media.kind === 'images' && media.images.some((image) => !image.alt)) || (media.kind === 'video' && !media.alt));
}

