import { authorName, cleanModelText, formatAge, type DescriptionParts } from '@/narration/buildNarration';
import type { Post, PostMedia, SocialAccount } from '@/social/types';

import type { Memory } from './memoryClient';
import type { NarrationSettings } from './settings';

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

function mediaFacts(media: PostMedia, parts: DescriptionParts | null, imageOffset: number): string {
  switch (media.kind) {
    case 'images':
      return media.images
        .map((image, i) => `image ${i + 1}: ${image.alt ?? (cleanModelText(parts?.images[imageOffset + i]?.description) || 'no description yet')}`)
        .join('; ');
    case 'video':
      return `video: ${media.alt ?? (cleanModelText(parts?.video) || 'no description yet')}`;
    case 'link':
      return `link: ${media.title || media.url}`;
    case 'quote':
      return `quotes a post by ${media.authorName}: "${media.text}"`;
  }
}

function mediaList(post: Post, parts: DescriptionParts | null): string {
  let offset = 0;
  return post.media
    .map((media) => {
      const facts = mediaFacts(media, parts, offset);
      if (media.kind === 'images') offset += media.images.length;
      return facts;
    })
    .join('; ');
}

// Facts about the post in focus, for the agent's understanding only. The agent reads posts aloud through
// read_post, never from this text.
export function describeFocus(post: Post | null, parts: DescriptionParts | null = null, now = new Date()): string {
  if (!post) return 'No post is in focus right now (the feed is empty or still loading).';
  return [
    `Author: ${authorName(post)} (@${post.author.handle}).`,
    post.repostedBy ? `Reposted by ${post.repostedBy}.` : null,
    `Posted ${formatAge(post.createdAt, now)}.`,
    post.replyRoot ? 'It is a reply to another post.' : null,
    `Text: ${post.text ? JSON.stringify(post.text) : '(no text)'}.`,
    post.media.length ? `Media: ${mediaList(post, parts)}.` : null,
    `Counts: ${plural(post.counts.likes, 'like')}, ${plural(post.counts.reposts, 'repost')}, ${post.counts.replies} ${post.counts.replies === 1 ? 'reply' : 'replies'}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function describeAccount(account: SocialAccount | null): string {
  return account ? `Signed in to Bluesky as @${account.handle}.` : 'Not signed in. Reading a public demo feed; liking, reposting, replying and posting need sign-in.';
}

export function describeSettings(settings: NarrationSettings): string {
  return [
    `Speech speed ${settings.rate} times normal.`,
    settings.mode === 'brief' ? 'Posts are read briefly.' : 'Posts are read in full.',
    settings.skipHashtags ? 'Hashtags are skipped.' : null,
    settings.pictureDetail === 'long' ? 'Picture descriptions are read in full.' : 'Picture descriptions are kept short.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function describeMemories(memories: Memory[] | null | 'signInNeeded'): string {
  if (memories === 'signInNeeded') return "Memory needs them to sign in again, because their sign-in is older than memory. Don't bring it up yourself; if memory comes up, a result will say what to tell them.";
  if (memories === null) return 'Memory is unavailable right now.';
  if (!memories.length) return 'Nothing yet.';
  return memories.map((memory) => `- [${memory.id}] ${memory.text}`).join('\n');
}
