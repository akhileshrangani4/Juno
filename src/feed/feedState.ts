import type { Post } from '@/social/types';

export type FeedState = {
  posts: Post[];
  index: number;
  cursor: string | null;
  exhausted: boolean;
  stalled: boolean;
  loading: boolean;
  error: string | null;
};

export type FeedAction =
  | { type: 'retry' }
  | { type: 'loadStarted' }
  | { type: 'pageLoaded'; posts: Post[]; cursor: string | null }
  | { type: 'loadFailed'; error: string }
  | { type: 'moved'; index: number };

export type MoveOutcome = 'moved' | 'atStart' | 'atEnd' | 'unavailable' | 'loading';

export const initialFeedState: FeedState = { posts: [], index: 0, cursor: null, exhausted: false, stalled: false, loading: false, error: null };

export const PREFETCH_DISTANCE = 5;

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'retry':
      return { ...state, error: null };
    case 'loadStarted':
      return { ...state, loading: true, error: null };
    case 'pageLoaded': {
      const seen = new Set(state.posts.map((post) => post.uri));
      const fresh = action.posts.filter((post) => !seen.has(post.uri) && seen.add(post.uri));
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
    case 'moved':
      return { ...state, index: action.index };
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
