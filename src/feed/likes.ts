import { useSyncExternalStore } from 'react';

import type { ActionHistory, UndoEntry } from '@/actions/history';
import { authorName } from '@/narration/buildNarration';
import { OfflineError, type Post, type SocialProvider } from '@/social/types';

type Likes = Pick<SocialProvider, 'like' | 'unlike'>;

const known = new Map<string, string | null>();
const sending = new Set<string>();
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
  sending.clear();
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

// A like or unlike that gets no answer in this long is given up on and reported as unconfirmed, so nothing stays
// pending for ever. If the answer comes later, the like state is updated to match it.
export const LIKE_TIMEOUT_MS = 10_000;

export class LikeTimeoutError extends Error {}

export type LikeFailure = 'offline' | 'timeout' | 'other';

// busy: a like or unlike of this post is already on the network. undone: the user said undo while it was on the
// network, and the undo tells them what happened.
export type LikeOutcome = { outcome: 'liked' | 'unliked' | 'busy' | 'undone' } | { outcome: 'failed'; wasLiked: boolean; reason: LikeFailure };

// One like or unlike per post at a time, by gesture or by voice, so a post can never get two like records.
export function likeInFlight(post: Pick<Post, 'uri'>): boolean {
  return sending.has(post.uri);
}

function bounded<T>(call: Promise<T>, late: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new LikeTimeoutError('Bluesky did not answer in time'));
    }, LIKE_TIMEOUT_MS);
    call.then(
      (value) => {
        clearTimeout(timer);
        if (expired) late(value);
        else resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!expired) reject(error);
      },
    );
  });
}

// Sends one like or unlike. Its undo entry goes on the history before the request, so an undo said while it is on the
// network reverses this action, never the one before it: the undo waits for the answer, then reverses it, or says
// there was nothing to undo if it didn't go through. An action that fails or changes nothing takes its entry back.
async function send<T>(
  post: Post,
  history: ActionHistory,
  label: string,
  call: () => Promise<T>,
  settle: (value: T) => boolean,
  reverse: (value: T) => Promise<string>,
  nothingToUndo: string,
): Promise<{ undone: boolean }> {
  sending.add(post.uri);
  const session = viewer;
  let undoAsked = false;
  let landed: Promise<{ value: T; changed: boolean } | null> = Promise.resolve(null);
  const entry: UndoEntry = {
    label,
    undo: async () => {
      undoAsked = true;
      const done = await landed;
      return done?.changed ? reverse(done.value) : nothingToUndo;
    },
  };
  history.push(entry);
  const result = (async () => {
    try {
      const value = await bounded(call(), (late) => {
        if (session === viewer) settle(late);
      });
      const changed = session === viewer && settle(value);
      if (!changed) history.remove(entry);
      return { value, changed };
    } catch (error) {
      history.remove(entry);
      throw error;
    } finally {
      if (session === viewer) sending.delete(post.uri);
    }
  })();
  landed = result.catch(() => null);
  try {
    await result;
  } catch (error) {
    if (!undoAsked) throw error;
  }
  return { undone: undoAsked };
}

// The one way the app likes and unlikes, by gesture or by voice, and what "undo" says it reversed.
export async function likePost(provider: Likes, post: Post, history: ActionHistory): Promise<'liked' | 'alreadyLiked' | 'busy' | 'undone'> {
  if (likeInFlight(post)) return 'busy';
  if (likeUriOf(post)) return 'alreadyLiked';
  const { undone } = await send(
    post,
    history,
    'like',
    () => provider.like(post),
    (record) => {
      recordLike(post.uri, record.uri);
      return true;
    },
    async (record) => {
      const removed = await provider.unlike(post, record);
      recordLike(post.uri, null);
      return removed ? `UNDONE: Removed your like on ${whose(post)}.` : 'NOTHING_TO_UNDO: It was not liked.';
    },
    `NOTHING_TO_UNDO: The like on ${whose(post)} didn't go through, so there was nothing to undo. Tell the user.`,
  );
  return undone ? 'undone' : 'liked';
}

export async function unlikePost(provider: Likes, post: Post, history: ActionHistory): Promise<'unliked' | 'notLiked' | 'busy' | 'undone'> {
  if (likeInFlight(post)) return 'busy';
  const current = likeUriOf(post);
  let removed = false;
  const { undone } = await send(
    post,
    history,
    'unlike',
    () => provider.unlike(post, current ? { uri: current } : undefined),
    (result) => {
      removed = result;
      recordLike(post.uri, null);
      return result;
    },
    async () => {
      const record = await provider.like(post);
      recordLike(post.uri, record.uri);
      return `UNDONE: Liked ${whose(post)} again.`;
    },
    `NOTHING_TO_UNDO: The like on ${whose(post)} wasn't removed, so there was nothing to undo. Tell the user.`,
  );
  if (undone) return 'undone';
  return removed ? 'unliked' : 'notLiked';
}

function failure(error: unknown): LikeFailure {
  if (error instanceof OfflineError) return 'offline';
  return error instanceof LikeTimeoutError ? 'timeout' : 'other';
}

export async function toggleLike(provider: Likes, post: Post, history: ActionHistory): Promise<LikeOutcome> {
  const wasLiked = !!likeUriOf(post);
  try {
    const result = wasLiked ? await unlikePost(provider, post, history) : await likePost(provider, post, history);
    if (result === 'notLiked') return { outcome: 'unliked' };
    if (result === 'alreadyLiked') return { outcome: 'liked' };
    return { outcome: result };
  } catch (error) {
    return { outcome: 'failed', wasLiked, reason: failure(error) };
  }
}
