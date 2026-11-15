import { mapFeedItem } from '../mapPost';

const base = {
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://cdn/avatar.jpg' },
    record: { $type: 'app.bsky.feed.post', text: 'Hello', createdAt: '2026-11-15T10:00:00.000Z' },
    indexedAt: '2026-11-15T10:00:05.000Z',
    likeCount: 3,
    repostCount: 2,
    replyCount: 1,
  },
};

const withEmbed = (embed: unknown) => ({ ...base, post: { ...base.post, embed } });

describe('mapFeedItem', () => {
  it('maps a plain post', () => {
    expect(mapFeedItem(base)).toEqual({
      uri: 'at://did:plc:alice/app.bsky.feed.post/1',
      cid: 'cid-1',
      author: { id: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice', avatarUrl: 'https://cdn/avatar.jpg' },
      text: 'Hello',
      createdAt: '2026-11-15T10:00:00.000Z',
      media: [],
      repostedBy: null,
      replyRoot: null,
      counts: { likes: 3, reposts: 2, replies: 1 },
    });
  });

  it('treats empty alt text as missing', () => {
    const post = mapFeedItem(
      withEmbed({
        $type: 'app.bsky.embed.images#view',
        images: [
          { thumb: 't1', fullsize: 'f1', alt: 'A dog' },
          { thumb: 't2', fullsize: 'f2', alt: '' },
        ],
      }),
    );
    expect(post?.media).toEqual([{ kind: 'images', images: [{ url: 'f1', alt: 'A dog' }, { url: 'f2', alt: null }] }]);
  });

  it('maps video, link and quote embeds', () => {
    expect(mapFeedItem(withEmbed({ $type: 'app.bsky.embed.video#view', playlist: 'p', thumbnail: 't' }))?.media).toEqual([
      { kind: 'video', alt: null, thumbUrl: 't' },
    ]);
    expect(
      mapFeedItem(withEmbed({ $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.com', title: 'Example', description: '' } }))?.media,
    ).toEqual([{ kind: 'link', url: 'https://example.com', title: 'Example' }]);
    expect(
      mapFeedItem(
        withEmbed({
          $type: 'app.bsky.embed.record#view',
          record: { $type: 'app.bsky.embed.record#viewRecord', author: { handle: 'bob.bsky.social' }, value: { text: 'Quoted' } },
        }),
      )?.media,
    ).toEqual([{ kind: 'quote', authorName: 'bob.bsky.social', text: 'Quoted' }]);
  });

  it('maps a quote that also carries media', () => {
    const post = mapFeedItem(
      withEmbed({
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't', fullsize: 'f', alt: 'Chart' }] },
        record: { record: { $type: 'app.bsky.embed.record#viewRecord', author: { displayName: 'Bob' }, value: { text: 'Quoted' } } },
      }),
    );
    expect(post?.media.map((media) => media.kind)).toEqual(['images', 'quote']);
  });

  it('skips quotes of deleted or blocked posts and unknown embeds', () => {
    expect(mapFeedItem(withEmbed({ $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewNotFound' } }))?.media).toEqual([]);
    expect(mapFeedItem(withEmbed({ $type: 'something.new#view' }))?.media).toEqual([]);
  });

  it('captures the reposter and the reply root', () => {
    const post = mapFeedItem({
      post: { ...base.post, record: { ...base.post.record, reply: { root: { uri: 'at://root', cid: 'root-cid' }, parent: { uri: 'at://parent', cid: 'p' } } } },
      reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { handle: 'bob.bsky.social', displayName: 'Bob' } },
    });
    expect(post?.repostedBy).toBe('Bob');
    expect(post?.replyRoot).toEqual({ uri: 'at://root', cid: 'root-cid' });
  });

  it('returns null for items it cannot read', () => {
    expect(mapFeedItem(null)).toBeNull();
    expect(mapFeedItem({ post: { uri: 'at://x' } })).toBeNull();
  });
});
