import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { FeedName, Post, SocialAccount, SocialProvider } from '@/social/types';
import { secureStore, type KeyValueStore } from '@/storage/keyValueStore';

import { feedReducer, initialFeedState, move, newPosts, shouldLoadMore, type MoveOutcome } from './feedState';
import { createRefreshTriggers } from './refreshTriggers';

const CHOICE_KEY = 'feed.choice';

type Options = { store?: KeyValueStore; onAutoRefresh?: (count: number) => void };

// The feed the user reads. Signed in, it is For You (Bluesky's Discover feed, picked for them) or Following, and
// the choice is kept across launches; signed out, it is the public Discover feed.
export function useFeed(provider: SocialProvider, account: SocialAccount | null, { store = secureStore, onAutoRefresh }: Options = {}) {
  const [chosen, setChosen] = useState<FeedName | null>(null);
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const feed: FeedName | null = account ? chosen : 'forYou';
  const source = feed && `${feed}:${account?.id ?? ''}`;
  const latest = useRef({ state, feed, source, onAutoRefresh, refresh: async (): Promise<number | null> => null });
  const waiting = useRef<((post: Post | null) => void)[]>([]);
  const triggers = useRef<ReturnType<typeof createRefreshTriggers> | null>(null);

  useEffect(() => {
    let live = true;
    store.get(CHOICE_KEY).then(
      (saved) => live && setChosen(saved === 'following' ? 'following' : 'forYou'),
      () => live && setChosen('forYou'),
    );
    return () => {
      live = false;
    };
  }, [store]);

  const refresh = async (): Promise<number | null> => {
    const before = latest.current;
    if (!before.feed || before.state.source !== before.source) return null;
    try {
      const page = await provider.getTimeline({ feed: before.feed });
      const now = latest.current.state;
      if (now.generation !== before.state.generation) return null;
      dispatch({ type: 'refreshed', posts: page.posts, cursor: page.cursor, generation: now.generation });
      return now.posts.length ? newPosts(now, page.posts).length : page.posts.length;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    latest.current = { state, feed, source, onAutoRefresh, refresh };
  });

  useEffect(() => {
    const current = createRefreshTriggers({
      now: Date.now,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      refresh: () => void latest.current.refresh().then((count) => count && latest.current.onAutoRefresh?.(count)),
      retry: () => dispatch({ type: 'retry' }),
    });
    triggers.current = current;
    const subscription = AppState.addEventListener('change', current.appState);
    return () => {
      subscription.remove();
      current.reset();
      triggers.current = null;
    };
  }, []);

  useEffect(() => {
    if (!source || state.source === source) return;
    triggers.current?.reset();
    dispatch({ type: 'reset', source });
  }, [source, state.source]);

  useEffect(() => {
    if (!feed || state.source !== source || !shouldLoadMore(state)) return;
    const { generation } = state;
    const hadPosts = state.posts.length > 0;
    dispatch({ type: 'loadStarted' });
    provider.getTimeline({ cursor: state.cursor ?? undefined, feed }).then(
      (page) => {
        dispatch({ type: 'pageLoaded', posts: page.posts, cursor: page.cursor, generation });
        if (latest.current.state.generation === generation) triggers.current?.loaded(hadPosts);
      },
      (error: unknown) => {
        dispatch({ type: 'loadFailed', error: error instanceof Error ? error.message : 'Unknown error', generation });
        if (latest.current.state.generation === generation) triggers.current?.failed();
      },
    );
  }, [state, provider, feed, source]);

  useEffect(() => {
    if (state.source !== source || !waiting.current.length) return;
    if (state.posts.length || state.error || state.exhausted) waiting.current.splice(0).forEach((resolve) => resolve(state.posts[state.index] ?? null));
  }, [state, source]);

  return {
    state,
    post: state.posts[state.index] ?? null,
    // The feed showing, or null signed out, when Following isn't offered.
    feed: account ? chosen : null,
    go(direction: 'next' | 'previous'): MoveOutcome {
      if (state.error) dispatch({ type: 'retry' });
      const { index, outcome } = move(state, direction);
      if (outcome === 'moved') dispatch({ type: 'moved', index });
      return outcome;
    },
    refresh,
    // Shows the other feed from its first post; resolves with that post once it loads, or null if it can't.
    switchTo(next: FeedName): Promise<Post | null> {
      setChosen(next);
      void store.set(CHOICE_KEY, next).catch(() => undefined);
      return new Promise((resolve) => waiting.current.push(resolve));
    },
    // Moves to the newest post: the first of the feed, or of the posts the last refresh brought in.
    toTop(): Post | null {
      const top = Math.min(state.top, Math.max(state.posts.length - 1, 0));
      dispatch({ type: 'toTop' });
      return state.posts[top] ?? null;
    },
  };
}
