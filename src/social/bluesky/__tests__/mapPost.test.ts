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
      replyTo: null,
      facets: [],
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
      { kind: 'video', alt: null, thumbUrl: 't', captions: [], aspectRatio: null },
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

  it('maps gallery embeds as images', () => {
    const post = mapFeedItem(withEmbed({ $type: 'app.bsky.embed.gallery#view', items: [{ thumbnail: 't1', fullsize: 'f1', alt: '' }, { thumbnail: 't2', fullsize: 'f2', alt: 'Cake' }] }));
    expect(post?.media).toEqual([{ kind: 'images', images: [{ url: 'f1', alt: null }, { url: 'f2', alt: 'Cake' }] }]);
  });

  it('keeps video captions and aspect ratio from the record', () => {
    const item = withEmbed({ $type: 'app.bsky.embed.video#view', thumbnail: 't', aspectRatio: { width: 1280, height: 720 } });
    item.post.record = {
      ...item.post.record,
      embed: { $type: 'app.bsky.embed.video', captions: [{ lang: 'en', file: { ref: { $link: 'bafycaption' } } }, { lang: 'fr', file: {} }] },
    } as typeof item.post.record;
    expect(mapFeedItem(item)?.media).toEqual([{ kind: 'video', alt: null, thumbUrl: 't', captions: [{ lang: 'en', cid: 'bafycaption' }], aspectRatio: { width: 1280, height: 720 } }]);
  });

  it('converts facet byte offsets to string offsets', () => {
    const text = 'Café 🎉 #Paris @bob.test https://x.org';
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    const at = (needle: string) => ({ byteStart: bytes(text.slice(0, text.indexOf(needle))), byteEnd: bytes(text.slice(0, text.indexOf(needle) + needle.length)) });
    const post = mapFeedItem({
      ...base,
      post: {
        ...base.post,
        record: {
          ...base.post.record,
          text,
          facets: [
            { index: at('#Paris'), features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Paris' }] },
            { index: at('@bob.test'), features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:bob' }] },
            { index: at('https://x.org'), features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.org' }] },
            { index: { byteStart: 3, byteEnd: 4 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'broken' }] },
          ],
        },
      },
    });
    expect(post?.facets).toEqual([
      { start: text.indexOf('#Paris'), end: text.indexOf('#Paris') + 6, kind: 'tag', tag: 'Paris' },
      { start: text.indexOf('@bob'), end: text.indexOf('@bob') + 9, kind: 'mention', did: 'did:plc:bob', name: null },
      { start: text.indexOf('https'), end: text.length, kind: 'link', url: 'https://x.org' },
    ]);
  });

  it('says who a reply answers, and whether it continues the author\'s own thread', () => {
    const reply = (parentDid: string) => ({
      post: { ...base.post, record: { ...base.post.record, reply: { root: { uri: 'at://r', cid: 'c' }, parent: { uri: 'at://p', cid: 'c' } } } },
      reply: { parent: { $type: 'app.bsky.feed.defs#postView', author: { did: parentDid, handle: 'maya.bsky.social', displayName: 'Maya' } } },
    });
    expect(mapFeedItem(reply('did:plc:maya'))?.replyTo).toEqual({ authorName: 'Maya', isSelf: false });
    expect(mapFeedItem(reply('did:plc:alice'))?.replyTo).toEqual({ authorName: 'Maya', isSelf: true });
    const orphan = { post: { ...base.post, record: { ...base.post.record, reply: { root: { uri: 'at://r', cid: 'c' } } } } };
    expect(mapFeedItem(orphan)?.replyTo).toEqual({ authorName: null, isSelf: false });
  });
});
