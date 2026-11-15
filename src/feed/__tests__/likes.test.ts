import { ActionHistory } from '@/actions/history';
import { OfflineError, type Post } from '@/social/types';
import { makePost } from '@/testing/fixtures';

import { forgetLikes, LIKE_TIMEOUT_MS, likeInFlight, likeUriOf, recordLike, toggleLike } from '../likes';

let n = 0;
const freshPost = (likeUri: string | null = null): Post => {
  n += 1;
  return makePost({ uri: `at://post/${n}`, cid: `cid-${n}`, likeUri });
};

function fakeProvider() {
  return { like: jest.fn(async () => ({ uri: 'at://me/app.bsky.feed.like/1' })), unlike: jest.fn(async () => true) };
}

describe('toggleLike', () => {
  it('likes a post the viewer has not liked, and remembers the like record to undo it', async () => {
    const provider = fakeProvider();
    const post = freshPost();
    const history = new ActionHistory();
    expect(await toggleLike(provider, post, history)).toEqual({ outcome: 'liked' });
    expect(provider.like).toHaveBeenCalledWith(post);
    expect(likeUriOf(post)).toBe('at://me/app.bsky.feed.like/1');
    expect(await toggleLike(provider, post, history)).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/app.bsky.feed.like/1' });
    expect(likeUriOf(post)).toBeNull();
  });

  it('removes the like from a post the feed says is already liked', async () => {
    const provider = fakeProvider();
    const post = freshPost('at://me/like/9');
    expect(await toggleLike(provider, post, new ActionHistory())).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/like/9' });
    expect(provider.like).not.toHaveBeenCalled();
  });

  it('reports a failure, which way it failed, and whether the network was down, and leaves the like state as it was', async () => {
    const provider = fakeProvider();
    const history = new ActionHistory();
    const post = freshPost();
    provider.like.mockRejectedValueOnce(new OfflineError('down'));
    expect(await toggleLike(provider, post, history)).toEqual({ outcome: 'failed', wasLiked: false, reason: 'offline' });
    expect(likeUriOf(post)).toBeNull();
    const liked = freshPost('at://me/like/9');
    provider.unlike.mockRejectedValueOnce(new Error('server error'));
    expect(await toggleLike(provider, liked, history)).toEqual({ outcome: 'failed', wasLiked: true, reason: 'other' });
    expect(likeUriOf(liked)).toBe('at://me/like/9');
    expect(history.size).toBe(0);
  });

  it('sees a like the voice agent made, so press and hold removes it instead of liking twice', async () => {
    const provider = fakeProvider();
    const post = freshPost();
    recordLike(post.uri, 'at://me/like/agent');
    expect(await toggleLike(provider, post, new ActionHistory())).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/like/agent' });
  });

  it('records each like and unlike on the history, and undo reverses it and says on whose post', async () => {
    const provider = fakeProvider();
    const history = new ActionHistory();
    const post = freshPost();
    await toggleLike(provider, post, history);
    expect(await history.pop()?.undo()).toBe("UNDONE: Removed your like on Alice Chen's post.");
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/app.bsky.feed.like/1' });
    expect(likeUriOf(post)).toBeNull();
    const liked = freshPost('at://me/like/9');
    await toggleLike(provider, liked, history);
    expect(await history.pop()?.undo()).toBe("UNDONE: Liked Alice Chen's post again.");
    expect(likeUriOf(liked)).toBe('at://me/app.bsky.feed.like/1');
    expect(await toggleLike(provider, { ...freshPost(), parentAuthor: null } as Post, history)).toEqual({ outcome: 'liked' });
    expect(await history.pop()?.undo()).toBe("UNDONE: Removed your like on Alice Chen's reply.");
  });

  it('forgets every like on sign-out, and a like still on the network then is not written back', async () => {
    let resolve!: (record: { uri: string }) => void;
    const provider = { like: jest.fn(() => new Promise<{ uri: string }>((r) => (resolve = r))), unlike: jest.fn(async () => true) };
    const history = new ActionHistory();
    const seen = freshPost();
    recordLike(seen.uri, 'at://a/like/1');
    const late = freshPost();
    const liking = toggleLike(provider, late, history);
    forgetLikes();
    expect(likeUriOf(seen)).toBeNull();
    resolve({ uri: 'at://a/like/2' });
    await liking;
    expect(likeUriOf(late)).toBeNull();
    expect(history.size).toBe(0);
  });
});

describe('a like that gets no answer', () => {
  afterEach(() => jest.useRealTimers());

  it('is reported as unconfirmed after the timeout but keeps its history entry and guard until Bluesky answers', async () => {
    jest.useFakeTimers();
    let answer!: (record: { uri: string }) => void;
    const provider = fakeProvider();
    provider.like.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const history = new ActionHistory();
    const post = freshPost();
    const liking = toggleLike(provider, post, history);
    jest.advanceTimersByTime(LIKE_TIMEOUT_MS);
    expect(await liking).toEqual({ outcome: 'unconfirmed', wasLiked: false });
    expect(history.size).toBe(1);
    expect(likeInFlight(post)).toBe(true);
    expect(await toggleLike(provider, post, history)).toEqual({ outcome: 'busy' });
    answer({ uri: 'at://me/like/late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(likeUriOf(post)).toBe('at://me/like/late');
    expect(likeInFlight(post)).toBe(false);
    expect(history.size).toBe(1);
    expect(provider.like).toHaveBeenCalledTimes(1);
  });

  it('takes its entry back when the late answer is a failure', async () => {
    jest.useFakeTimers();
    let fail!: (error: Error) => void;
    const provider = fakeProvider();
    provider.like.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const history = new ActionHistory();
    const post = freshPost();
    const liking = toggleLike(provider, post, history);
    jest.advanceTimersByTime(LIKE_TIMEOUT_MS);
    await liking;
    fail(new Error('server error'));
    await Promise.resolve();
    await Promise.resolve();
    expect(history.size).toBe(0);
    expect(likeInFlight(post)).toBe(false);
    expect(likeUriOf(post)).toBeNull();
  });
});
