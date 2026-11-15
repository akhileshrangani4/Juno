import { useEffect, useReducer } from 'react';

import type { SocialProvider } from '@/social/types';

import { feedReducer, initialFeedState, move, shouldLoadMore, type MoveOutcome } from './feedState';

export function useFeed(provider: SocialProvider) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);

  useEffect(() => {
    if (!shouldLoadMore(state)) return;
    dispatch({ type: 'loadStarted' });
    provider.getTimeline({ cursor: state.cursor ?? undefined }).then(
      (page) => dispatch({ type: 'pageLoaded', posts: page.posts, cursor: page.cursor }),
      (error: unknown) => dispatch({ type: 'loadFailed', error: error instanceof Error ? error.message : 'Unknown error' }),
    );
  }, [state, provider]);

  return {
    state,
    post: state.posts[state.index] ?? null,
    go(direction: 'next' | 'previous'): MoveOutcome {
      if (state.error) dispatch({ type: 'retry' });
      const { index, outcome } = move(state, direction);
      if (outcome === 'moved') dispatch({ type: 'moved', index });
      return outcome;
    },
  };
}
