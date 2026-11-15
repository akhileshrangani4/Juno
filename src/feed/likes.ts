import { useSyncExternalStore } from 'react';

import type { ActionHistory } from '@/actions/history';
import { authorName } from '@/narration/buildNarration';
import { OfflineError, type Post, type RecordRef, type SocialProvider } from '@/social/types';

export type LikeOutcome = { outcome: 'liked' } | { outcome: 'unliked' } | { outcome: 'failed'; wasLiked: boolean; offline: boolean };

type Likes = Pick<SocialProvider, 'like' | 'unlike'>;

const known = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;
let viewer = 0;

const changed = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

export function recordLike(postUri: string, likeUri: string | null): void {
  known.set(postUri, likeUri);
  changed();
}

export function likeUriOf(post: Pick<Post, 'uri' | 'likeUri'>): string | null {
  return known.has(post.uri) ? (known.get(post.uri) ?? null) : post.likeUri;
}

// Forgets every like the app knows about, for sign-out and account changes. A like still on the network when this
// runs belonged to the previous account, so it doesn't write its result back.
export function forgetLikes(): void {
  known.clear();
  viewer += 1;
  changed();
}

export function useLikeLedger(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => version,
  );
}

// "Maya's post" or "Maya's reply", for messages about a like.
export function whose(post: Post): string {
  return `${authorName(post)}'s ${'parentAuthor' in post ? 'reply' : 'post'}`;
}

// The one way the app likes and unlikes, by gesture or by voice. Each records what it did on the action history, so
// "undo" reverses it like any other action and says what it reversed.
export async function likePost(provider: Likes, post: Post, history: ActionHistory): Promise<RecordRef> {
  const session = viewer;
  const record = await provider.like(post);
  if (session !== viewer) return record;
  recordLike(post.uri, record.uri);
  history.push({
    label: 'like',
    undo: async () => {
      const removed = await provider.unlike(post, record);
      recordLike(post.uri, null);
      return removed ? `UNDONE: Removed your like on ${whose(post)}.` : 'NOTHING_TO_UNDO: It was not liked.';
    },
  });
  return record;
}

export async function unlikePost(provider: Likes, post: Post, history: ActionHistory): Promise<boolean> {
  const session = viewer;
  const current = likeUriOf(post);
  const removed = await provider.unlike(post, current ? { uri: current } : undefined);
  if (session !== viewer) return removed;
  recordLike(post.uri, null);
  if (removed) {
    history.push({
      label: 'unlike',
      undo: async () => {
        const record = await provider.like(post);
        recordLike(post.uri, record.uri);
        return `UNDONE: Liked ${whose(post)} again.`;
      },
    });
  }
  return removed;
}

export async function toggleLike(provider: Likes, post: Post, history: ActionHistory): Promise<LikeOutcome> {
  const wasLiked = !!likeUriOf(post);
  try {
    if (wasLiked) {
      await unlikePost(provider, post, history);
      return { outcome: 'unliked' };
    }
    await likePost(provider, post, history);
    return { outcome: 'liked' };
  } catch (error) {
    return { outcome: 'failed', wasLiked, offline: error instanceof OfflineError };
  }
}
