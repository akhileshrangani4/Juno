import { useSyncExternalStore } from 'react';

import { OfflineError, type PostRef, type SocialProvider } from '@/social/types';

export type Likeable = PostRef & { likeUri: string | null };

export type LikeOutcome = { outcome: 'liked' } | { outcome: 'unliked' } | { outcome: 'signedOut' } | { outcome: 'failed'; wasLiked: boolean; offline: boolean };

const known = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

export function recordLike(postUri: string, likeUri: string | null): void {
  known.set(postUri, likeUri);
  version += 1;
  listeners.forEach((listener) => listener());
}

export function likeUriOf(item: Likeable): string | null {
  return known.has(item.uri) ? (known.get(item.uri) ?? null) : item.likeUri;
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

export async function toggleLike(provider: Pick<SocialProvider, 'like' | 'unlike'>, item: Likeable, signedIn: boolean): Promise<LikeOutcome> {
  if (!signedIn) return { outcome: 'signedOut' };
  const current = likeUriOf(item);
  try {
    if (current) {
      await provider.unlike(item, { uri: current });
      recordLike(item.uri, null);
      return { outcome: 'unliked' };
    }
    const record = await provider.like(item);
    recordLike(item.uri, record.uri);
    return { outcome: 'liked' };
  } catch (error) {
    return { outcome: 'failed', wasLiked: !!current, offline: error instanceof OfflineError };
  }
}
