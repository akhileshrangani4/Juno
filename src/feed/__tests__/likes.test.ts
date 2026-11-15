import { OfflineError } from '@/social/types';

import { likeUriOf, recordLike, toggleLike } from '../likes';

let n = 0;
const freshPost = (likeUri: string | null = null) => {
  n += 1;
  return { uri: `at://post/${n}`, cid: `cid-${n}`, likeUri };
};

function fakeProvider() {
  return { like: jest.fn(async () => ({ uri: 'at://me/app.bsky.feed.like/1' })), unlike: jest.fn(async () => true) };
}

describe('toggleLike', () => {
  it('likes a post the viewer has not liked, and remembers the like record to undo it', async () => {
    const provider = fakeProvider();
    const post = freshPost();
    expect(await toggleLike(provider, post, true)).toEqual({ outcome: 'liked' });
    expect(provider.like).toHaveBeenCalledWith(post);
    expect(likeUriOf(post)).toBe('at://me/app.bsky.feed.like/1');
    expect(await toggleLike(provider, post, true)).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/app.bsky.feed.like/1' });
    expect(likeUriOf(post)).toBeNull();
  });

  it('removes the like from a post the feed says is already liked', async () => {
    const provider = fakeProvider();
    const post = freshPost('at://me/like/9');
    expect(await toggleLike(provider, post, true)).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/like/9' });
    expect(provider.like).not.toHaveBeenCalled();
  });

  it('does nothing when signed out', async () => {
    const provider = fakeProvider();
    expect(await toggleLike(provider, freshPost(), false)).toEqual({ outcome: 'signedOut' });
    expect(provider.like).not.toHaveBeenCalled();
    expect(provider.unlike).not.toHaveBeenCalled();
  });

  it('reports a failure, which way it failed, and whether the network was down, and leaves the like state as it was', async () => {
    const provider = fakeProvider();
    const post = freshPost();
    provider.like.mockRejectedValueOnce(new OfflineError('down'));
    expect(await toggleLike(provider, post, true)).toEqual({ outcome: 'failed', wasLiked: false, offline: true });
    expect(likeUriOf(post)).toBeNull();
    const liked = freshPost('at://me/like/9');
    provider.unlike.mockRejectedValueOnce(new Error('server error'));
    expect(await toggleLike(provider, liked, true)).toEqual({ outcome: 'failed', wasLiked: true, offline: false });
    expect(likeUriOf(liked)).toBe('at://me/like/9');
  });

  it('sees a like the voice agent made, so press and hold removes it instead of liking twice', async () => {
    const provider = fakeProvider();
    const post = freshPost();
    recordLike(post.uri, 'at://me/like/agent');
    expect(await toggleLike(provider, post, true)).toEqual({ outcome: 'unliked' });
    expect(provider.unlike).toHaveBeenCalledWith(post, { uri: 'at://me/like/agent' });
  });
});
