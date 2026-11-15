import { useReducer, useRef } from 'react';

import type { Reply, SocialProvider } from '@/social/types';

import { commentsReducer, initialCommentsState, moveReply, openThread, type ReplyMoveOutcome } from './commentsState';

export function useComments(provider: SocialProvider) {
  const [state, dispatch] = useReducer(commentsReducer, initialCommentsState);
  const requests = useRef(new Map<string, Promise<Reply[]>>());

  const load = (postUri: string): Promise<Reply[]> => {
    const cached = requests.current.get(postUri);
    if (cached) return cached;
    const request = provider.getReplies(postUri);
    requests.current.set(postUri, request);
    request.catch(() => requests.current.delete(postUri));
    return request;
  };

  const thread = openThread(state);

  return {
    state,
    thread,
    reply: thread?.status === 'ready' ? (thread.replies[thread.index] ?? null) : null,
    open(postUri: string, onFailed: () => void): void {
      dispatch({ type: 'open', postUri });
      load(postUri).then(
        (replies) => dispatch({ type: 'loaded', postUri, replies }),
        () => {
          onFailed();
          dispatch({ type: 'failed', postUri });
        },
      );
    },
    close(): void {
      dispatch({ type: 'close' });
    },
    move(direction: 'next' | 'previous'): ReplyMoveOutcome {
      if (!thread) return 'loading';
      const { index, outcome } = moveReply(thread, direction);
      if (outcome === 'moved') dispatch({ type: 'moved', index });
      return outcome;
    },
    async read(postUri: string): Promise<Reply[]> {
      const replies = await load(postUri);
      dispatch({ type: 'loaded', postUri, replies });
      return replies;
    },
  };
}
