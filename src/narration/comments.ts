import type { PostAuthor, Reply } from '@/social/types';

import { buildPostScript, replyCount, type ScriptOptions } from './buildNarration';

const nameOf = (author: PostAuthor) => author.displayName?.trim() || author.handle.replace(/\.bsky\.social$/, '');

export function commentsEntry(count: number, summary: string | null = null): string {
  if (count === 0) return 'No replies yet. Swipe down to go back.';
  // AKH-10 follow-up: `summary` is the one-sentence "what people are saying"; nothing supplies it yet.
  return [replyCount(count), summary, 'Swipe down to go back.'].filter(Boolean).join(' ');
}

export function replyPosition(reply: Reply, index: number, total: number) {
  return { index, total, answering: reply.parentAuthor ? nameOf(reply.parentAuthor) : null };
}

export function buildReplyScript(reply: Reply, index: number, total: number, options: Omit<ScriptOptions, 'reply'> = { now: new Date() }): string {
  return buildPostScript(reply, { ...options, reply: replyPosition(reply, index, total) });
}

export const commentMessages = {
  loading: 'Loading replies.',
  failed: 'Could not load the replies. Back to posts.',
  backToPosts: 'Back to posts.',
  atStart: 'This is the first reply.',
  atEnd: 'That was the last reply. Swipe down to go back.',
  alreadyOpen: 'You are already in the replies. Swipe down to go back.',
  noPost: 'There is no post to open.',
  camera: 'The camera is coming soon.',
  liked: 'Liked.',
  unliked: 'Like removed.',
  signInToLike: 'You need to sign in to like posts. Draw a clockwise circle, then tap the bottom half for account settings.',
};

// A like that didn't go through, said whatever is in focus by then, so it names the post it was made on.
export function likeFailure(whose: string, wasLiked: boolean, offline: boolean): string {
  return `${wasLiked ? `Couldn't remove your like on ${whose}.` : `Couldn't like ${whose}.`} ${offline ? "Bluesky can't be reached. Check your connection." : 'Nothing changed.'}`;
}
