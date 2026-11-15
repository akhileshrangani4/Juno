import type { Post } from '@/social/types';

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    uri: 'at://did:plc:alice/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: { id: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice Chen', avatarUrl: null },
    text: 'Hello world',
    createdAt: '2026-11-15T10:00:00.000Z',
    media: [],
    repostedBy: null,
    replyRoot: null,
    counts: { likes: 0, reposts: 0, replies: 0 },
    likeUri: null,
    ...overrides,
  };
}

export const makePosts = (count: number, offset = 0): Post[] =>
  Array.from({ length: count }, (_, i) => makePost({ uri: `at://post/${offset + i}`, cid: `cid-${offset + i}`, text: `Post ${offset + i}` }));
