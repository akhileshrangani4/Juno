import { makePosts } from '@/testing/fixtures';

import { feedReducer, initialFeedState, move, newPosts, PREFETCH_DISTANCE, shouldLoadMore, type FeedState } from '../feedState';

const loaded = (count: number, overrides: Partial<FeedState> = {}): FeedState => ({
  ...feedReducer(initialFeedState, { type: 'pageLoaded', posts: makePosts(count), cursor: 'c1' }),
  ...overrides,
});

describe('feedReducer', () => {
  it('appends pages, keeps the cursor and drops posts it already has', () => {
    const first = loaded(3);
    const second = feedReducer(first, { type: 'pageLoaded', posts: makePosts(3, 2), cursor: 'c2' });
    expect(second.posts.map((post) => post.uri)).toEqual(['at://post/0', 'at://post/1', 'at://post/2', 'at://post/3', 'at://post/4']);
    expect(second.cursor).toBe('c2');
    expect(second.exhausted).toBe(false);
  });

  it('marks the feed exhausted when the cursor ends or a page brings nothing new', () => {
    expect(feedReducer(loaded(3), { type: 'pageLoaded', posts: makePosts(2, 3), cursor: null }).exhausted).toBe(true);
    expect(feedReducer(loaded(3), { type: 'pageLoaded', posts: makePosts(3), cursor: 'c2' }).exhausted).toBe(true);
  });

  it('tells a feed that ended apart from one where nothing could be shown', () => {
    const ended = feedReducer(loaded(3, { index: 2 }), { type: 'pageLoaded', posts: [], cursor: null });
    expect(ended).toMatchObject({ exhausted: true, stalled: false });
    expect(move(ended, 'next').outcome).toBe('atEnd');
    const stalled = feedReducer(loaded(3, { index: 2 }), { type: 'pageLoaded', posts: [], cursor: 'c9' });
    expect(stalled).toMatchObject({ exhausted: true, stalled: true });
    expect(move(stalled, 'next').outcome).toBe('unavailable');
    expect(shouldLoadMore(stalled)).toBe(false);
  });

  it('tracks loading and errors, and clears the error on retry', () => {
    const loading = feedReducer(initialFeedState, { type: 'loadStarted' });
    expect(loading.loading).toBe(true);
    const failed = feedReducer(loading, { type: 'loadFailed', error: 'offline' });
    expect(failed).toMatchObject({ loading: false, error: 'offline' });
    expect(feedReducer(failed, { type: 'retry' }).error).toBeNull();
  });

  it('keeps the focused post when more posts arrive', () => {
    const state = feedReducer(loaded(3, { index: 2 }), { type: 'pageLoaded', posts: makePosts(3, 3), cursor: 'c2' });
    expect(state.index).toBe(2);
  });
});

describe('move', () => {
  it('steps one post at a time in both directions', () => {
    expect(move(loaded(3, { index: 1 }), 'next')).toEqual({ index: 2, outcome: 'moved' });
    expect(move(loaded(3, { index: 1 }), 'previous')).toEqual({ index: 0, outcome: 'moved' });
  });

  it('stays on the first post and says so', () => {
    expect(move(loaded(3), 'previous')).toEqual({ index: 0, outcome: 'atStart' });
  });

  it('waits at the last post while more can load, and reports the end when none can', () => {
    expect(move(loaded(3, { index: 2 }), 'next')).toEqual({ index: 2, outcome: 'loading' });
    expect(move(loaded(3, { index: 2, exhausted: true }), 'next')).toEqual({ index: 2, outcome: 'atEnd' });
    expect(move({ ...initialFeedState, exhausted: true }, 'next')).toEqual({ index: 0, outcome: 'atEnd' });
  });
});

describe('shouldLoadMore', () => {
  it('loads the first page', () => {
    expect(shouldLoadMore(initialFeedState)).toBe(true);
  });

  it('prefetches when the focused post nears the end', () => {
    expect(shouldLoadMore(loaded(30, { index: 0 }))).toBe(false);
    expect(shouldLoadMore(loaded(30, { index: 30 - PREFETCH_DISTANCE - 1 }))).toBe(false);
    expect(shouldLoadMore(loaded(30, { index: 30 - PREFETCH_DISTANCE }))).toBe(true);
  });

  it('does not load while loading, after an error, or once exhausted', () => {
    expect(shouldLoadMore(loaded(3, { loading: true }))).toBe(false);
    expect(shouldLoadMore(loaded(3, { error: 'offline' }))).toBe(false);
    expect(shouldLoadMore(loaded(3, { exhausted: true }))).toBe(false);
  });
});

describe('switching and refreshing', () => {
  const uris = (state: FeedState) => state.posts.map((post) => post.uri);

  it('starts a switched feed empty at its first post, and drops pages asked for before the switch', () => {
    const before = loaded(3, { index: 2, generation: 1 });
    const switched = feedReducer(before, { type: 'reset', source: 'following:did:plc:me' });
    expect(switched).toMatchObject({ posts: [], index: 0, top: 0, source: 'following:did:plc:me', generation: 2 });
    expect(feedReducer(switched, { type: 'pageLoaded', posts: makePosts(2), cursor: 'c', generation: 1 })).toBe(switched);
    expect(feedReducer(switched, { type: 'loadFailed', error: 'offline', generation: 1 })).toBe(switched);
    expect(uris(feedReducer(switched, { type: 'pageLoaded', posts: makePosts(2), cursor: 'c', generation: 2 }))).toEqual(['at://post/0', 'at://post/1']);
  });

  it('puts new posts just before the one in focus, keeps focus on it, and can jump to the newest', () => {
    const reading = loaded(4, { index: 2 });
    const refreshed = feedReducer(reading, { type: 'refreshed', posts: [...makePosts(3, 10), ...makePosts(2)], cursor: 'r' });
    expect(uris(refreshed)).toEqual(['at://post/0', 'at://post/1', 'at://post/10', 'at://post/11', 'at://post/12', 'at://post/2', 'at://post/3']);
    expect(refreshed.posts[refreshed.index].uri).toBe('at://post/2');
    expect(refreshed.cursor).toBe('c1');
    expect(move(refreshed, 'previous').index).toBe(4);
    const top = feedReducer(refreshed, { type: 'toTop' });
    expect(top.posts[top.index].uri).toBe('at://post/10');
    expect(newPosts(reading, [...makePosts(3, 10), ...makePosts(2)])).toHaveLength(3);
  });

  it('changes nothing when there is nothing new, and loads the first posts into an empty feed', () => {
    const reading = loaded(4, { index: 2, error: 'offline' });
    expect(feedReducer(reading, { type: 'refreshed', posts: makePosts(4), cursor: 'r' })).toEqual({ ...reading, error: null });
    const empty = feedReducer(initialFeedState, { type: 'refreshed', posts: makePosts(2), cursor: 'r' });
    expect(empty).toMatchObject({ index: 0, cursor: 'r' });
    expect(uris(empty)).toEqual(['at://post/0', 'at://post/1']);
  });
});
