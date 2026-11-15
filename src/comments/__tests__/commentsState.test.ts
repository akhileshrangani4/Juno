import type { Reply } from '@/social/types';
import { makePost } from '@/testing/fixtures';

import { commentsReducer, initialCommentsState, moveReply, openThread, type CommentsState } from '../commentsState';

const replies = (count: number): Reply[] => Array.from({ length: count }, (_, i) => ({ ...makePost({ uri: `at://reply/${i}` }), parentAuthor: null }));

const ready = (count: number): CommentsState =>
  commentsReducer(commentsReducer(initialCommentsState, { type: 'open', postUri: 'at://post/1' }), { type: 'loaded', postUri: 'at://post/1', replies: replies(count) });

describe('commentsReducer', () => {
  it('opens in a loading state, then shows the first reply', () => {
    const loading = commentsReducer(initialCommentsState, { type: 'open', postUri: 'at://post/1' });
    expect(openThread(loading)).toMatchObject({ status: 'loading' });
    expect(moveReply(openThread(loading)!, 'next').outcome).toBe('loading');
    expect(openThread(ready(3))).toMatchObject({ status: 'ready', index: 0 });
  });

  it('moves one reply at a time and stops at both ends without leaving', () => {
    let state = ready(2);
    expect(moveReply(openThread(state)!, 'previous')).toEqual({ index: 0, outcome: 'atStart' });
    const next = moveReply(openThread(state)!, 'next');
    expect(next).toEqual({ index: 1, outcome: 'moved' });
    state = commentsReducer(state, { type: 'moved', index: next.index });
    expect(moveReply(openThread(state)!, 'next')).toEqual({ index: 1, outcome: 'atEnd' });
    expect(state.open).toBe('at://post/1');
  });

  it('keeps the place when the user leaves and comes back, and a repeated load does not reset it', () => {
    let state = commentsReducer(ready(5), { type: 'moved', index: 3 });
    state = commentsReducer(state, { type: 'close' });
    expect(openThread(state)).toBeNull();
    state = commentsReducer(state, { type: 'open', postUri: 'at://post/1' });
    expect(openThread(state)).toMatchObject({ status: 'ready', index: 3 });
    state = commentsReducer(state, { type: 'loaded', postUri: 'at://post/1', replies: replies(5) });
    expect(openThread(state)?.index).toBe(3);
  });

  it('a failed load closes the comments and forgets the thread so the next visit retries', () => {
    const loading = commentsReducer(initialCommentsState, { type: 'open', postUri: 'at://post/1' });
    const failed = commentsReducer(loading, { type: 'failed', postUri: 'at://post/1' });
    expect(failed).toEqual(initialCommentsState);
  });

  it('can load another post\'s replies in the background without opening them', () => {
    const state = commentsReducer(initialCommentsState, { type: 'loaded', postUri: 'at://post/2', replies: replies(1) });
    expect(state.open).toBeNull();
    expect(state.threads['at://post/2'].status).toBe('ready');
  });
});
