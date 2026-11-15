import { useSyncExternalStore } from 'react';

import type { ActionHistory, UndoEntry } from '@/actions/history';
import { authorName } from '@/narration/buildNarration';
import { likeFailure } from '@/narration/comments';
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

// How long a like or unlike waits for Bluesky before the user is told it isn't confirmed. Only what the user hears
// changes: the request, its undo entry and the post's in-flight guard all stay until Bluesky really answers.
export const LIKE_TIMEOUT_MS = 10_000;

export type LikeFailure = 'offline' | 'other';

// busy: a like or unlike of this post is already on the network. undone: the user said undo while it was on the
// network, and the undo tells them what happened. unconfirmed: Bluesky hasn't answered within LIKE_TIMEOUT_MS.
export type LikeOutcome =
  | { outcome: 'liked' | 'unliked' | 'busy' | 'undone' }
  | { outcome: 'unconfirmed'; wasLiked: boolean }
  | { outcome: 'failed'; wasLiked: boolean; reason: LikeFailure };

// One like or unlike per post at a time, by gesture or by voice, so a post can never get two like records.
export function likeInFlight(post: Pick<Post, 'uri'>): boolean {
  return sending.has(post.uri);
}

function failure(error: unknown): LikeFailure {
  return error instanceof OfflineError ? 'offline' : 'other';
}

type Settled<T> = { ok: true; value: T; changed: boolean } | { ok: false; error: unknown };

type Send<T> = {
  call: () => Promise<T>;
  // Records the answer in the like state; false when it changed nothing.
  settle: (value: T) => boolean;
  // Reverses it for undo, and says what was reversed.
  reverse: (value: T) => Promise<string>;
  // What undo says while Bluesky hasn't answered yet.
  pending: string;
  // What the user hears if that deferred reversal fails.
  reverseFailed: (error: unknown) => string;
};

// Sends one like or unlike. Its undo entry goes on the history before the request and the post is guarded until the
// request settles, however long that takes, so undo never skips it to reach an older action and the post is never
// sent twice. When it settles, an action that changed something stays on the history as an ordinary undoable action;
// one that failed or changed nothing takes its entry back. An undo said before it settles is promised at once and
// carried out when it settles; only a reversal that then fails is said.
async function send<T>(post: Post, history: ActionHistory, label: string, steps: Send<T>): Promise<'done' | 'undone' | 'unconfirmed'> {
  sending.add(post.uri);
  const session = viewer;
  let undoAsked = false;
  let state: Settled<T> | null = null;
  const entry: UndoEntry = {
    label,
    undo: async () => {
      undoAsked = true;
      if (state?.ok) return steps.reverse(state.value);
      return steps.pending;
    },
  };
  history.push(entry);
  const settled = steps.call().then(
    (value): Settled<T> => ({ ok: true, value, changed: session === viewer && steps.settle(value) }),
    (error: unknown): Settled<T> => ({ ok: false, error }),
  );
  void settled.then((result) => {
    state = result;
    if (session === viewer) sending.delete(post.uri);
    if (!result.ok || !result.changed) return history.remove(entry);
    if (!undoAsked) return;
    steps.reverse(result.value).catch((error: unknown) => {
      history.push(entry);
      history.tell(steps.reverseFailed(error));
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([settled, new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), LIKE_TIMEOUT_MS)))]);
  clearTimeout(timer);
  if (undoAsked) return 'undone';
  if (first === 'timeout') return 'unconfirmed';
  if (!first.ok) throw first.error;
  return 'done';
}

// The one way the app likes and unlikes, by gesture or by voice, and what "undo" says it reversed.
export async function likePost(provider: Likes, post: Post, history: ActionHistory): Promise<'liked' | 'alreadyLiked' | 'busy' | 'undone' | 'unconfirmed'> {
  if (likeInFlight(post)) return 'busy';
  if (likeUriOf(post)) return 'alreadyLiked';
  const sent = await send(post, history, 'like', {
    call: () => provider.like(post),
    settle: (record) => {
      recordLike(post.uri, record.uri);
      return true;
    },
    reverse: async (record) => {
      const removed = await provider.unlike(post, record);
      recordLike(post.uri, null);
      return removed ? `UNDONE: Removed your like on ${whose(post)}.` : 'NOTHING_TO_UNDO: It was not liked.';
    },
    pending: `UNDO_PENDING: Bluesky hasn't answered the like on ${whose(post)} yet. The app removes the like as soon as Bluesky answers.`,
    reverseFailed: (error) => likeFailure(whose(post), true, failure(error)),
  });
  return sent === 'done' ? 'liked' : sent;
}

export async function unlikePost(provider: Likes, post: Post, history: ActionHistory): Promise<'unliked' | 'notLiked' | 'busy' | 'undone' | 'unconfirmed'> {
  if (likeInFlight(post)) return 'busy';
  const current = likeUriOf(post);
  let removed = false;
  const sent = await send(post, history, 'unlike', {
    call: () => provider.unlike(post, current ? { uri: current } : undefined),
    settle: (result) => {
      removed = result;
      recordLike(post.uri, null);
      return result;
    },
    reverse: async () => {
      const record = await provider.like(post);
      recordLike(post.uri, record.uri);
      return `UNDONE: Liked ${whose(post)} again.`;
    },
    pending: `UNDO_PENDING: Bluesky hasn't answered yet about removing the like on ${whose(post)}. The app puts the like back as soon as Bluesky answers.`,
    reverseFailed: (error) => likeFailure(whose(post), false, failure(error)),
  });
  if (sent !== 'done') return sent;
  return removed ? 'unliked' : 'notLiked';
}

export async function toggleLike(provider: Likes, post: Post, history: ActionHistory): Promise<LikeOutcome> {
  const wasLiked = !!likeUriOf(post);
  try {
    const result = wasLiked ? await unlikePost(provider, post, history) : await likePost(provider, post, history);
    if (result === 'unconfirmed') return { outcome: 'unconfirmed', wasLiked };
    if (result === 'notLiked') return { outcome: 'unliked' };
    if (result === 'alreadyLiked') return { outcome: 'liked' };
    return { outcome: result };
  } catch (error) {
    return { outcome: 'failed', wasLiked, reason: failure(error) };
  }
}
