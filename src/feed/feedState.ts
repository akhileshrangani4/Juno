import type { Post } from '@/social/types';

export type FeedState = {
  posts: Post[];
  index: number;
  cursor: string | null;
  exhausted: boolean;
  stalled: boolean;
  loading: boolean;
  error: string | null;
  // Which feed, for which account, the posts are from; null before the first reset.
  source: string | null;
  // Counts resets, so a page asked for before the feed changed is dropped when it lands.
  generation: number;
  // Where the newest posts start: 0, or where the last refresh put the posts that came in since.
  top: number;
};

export type FeedAction =
  | { type: 'reset'; source: string }
  | { type: 'retry' }
  | { type: 'loadStarted' }
  | { type: 'pageLoaded'; posts: Post[]; cursor: string | null; generation?: number }
  | { type: 'loadFailed'; error: string; generation?: number }
  | { type: 'refreshed'; posts: Post[]; cursor: string | null; generation?: number }
  | { type: 'moved'; index: number }
  | { type: 'toTop' };

export type MoveOutcome = 'moved' | 'atStart' | 'atEnd' | 'unavailable' | 'loading';

export const initialFeedState: FeedState = { posts: [], index: 0, cursor: null, exhausted: false, stalled: false, loading: false, error: null, source: null, generation: 0, top: 0 };

export const PREFETCH_DISTANCE = 5;

// The posts of a refresh the feed doesn't have yet.
export function newPosts(state: FeedState, posts: Post[]): Post[] {
  const seen = new Set(state.posts.map((post) => post.uri));
  return posts.filter((post) => !seen.has(post.uri) && seen.add(post.uri));
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  if ('generation' in action && action.generation !== undefined && action.generation !== state.generation) return state;
  switch (action.type) {
    case 'reset':
      return { ...initialFeedState, source: action.source, generation: state.generation + 1 };
    case 'retry':
      return { ...state, error: null };
    case 'loadStarted':
      return { ...state, loading: true, error: null };
    case 'pageLoaded': {
      const fresh = newPosts(state, action.posts);
      return {
        ...state,
        posts: [...state.posts, ...fresh],
        cursor: action.cursor,
        exhausted: action.cursor === null || fresh.length === 0,
        stalled: action.cursor !== null && fresh.length === 0,
        loading: false,
      };
    }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error };
    case 'refreshed': {
      if (!state.posts.length) return { ...feedReducer(state, { type: 'pageLoaded', posts: action.posts, cursor: action.cursor }), error: null };
      const fresh = newPosts(state, action.posts);
      if (!fresh.length) return { ...state, error: null };
      // New posts go just before the one in focus, so the user stays where they are and "previous" reaches them.
      return {
        ...state,
        posts: [...state.posts.slice(0, state.index), ...fresh, ...state.posts.slice(state.index)],
        index: state.index + fresh.length,
        top: state.index,
        error: null,
      };
    }
    case 'moved':
      return { ...state, index: action.index };
    case 'toTop':
      return { ...state, index: Math.min(state.top, Math.max(state.posts.length - 1, 0)) };
  }
}

export function move(state: FeedState, direction: 'next' | 'previous'): { index: number; outcome: MoveOutcome } {
  if (direction === 'previous') {
    return state.index === 0 ? { index: 0, outcome: 'atStart' } : { index: state.index - 1, outcome: 'moved' };
  }
  if (state.index < state.posts.length - 1) return { index: state.index + 1, outcome: 'moved' };
  return { index: state.index, outcome: state.loading || !state.exhausted ? 'loading' : state.stalled ? 'unavailable' : 'atEnd' };
}

export function shouldLoadMore(state: FeedState): boolean {
  return !state.loading && !state.exhausted && !state.error && state.posts.length - 1 - state.index < PREFETCH_DISTANCE;
}
