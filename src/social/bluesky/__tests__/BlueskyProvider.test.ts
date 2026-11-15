import { createMemoryStore } from '@/storage/keyValueStore';

import { BlueskyProvider } from '../BlueskyProvider';

const FAKE_APP_KEY = 'fake-app-key';
const signInWithKey = (provider: BlueskyProvider, identifier: string) => provider.signInWithAppPassword.call(provider, identifier, FAKE_APP_KEY);

const feedItem = (n: number) => ({
  post: {
    uri: `at://post/${n}`,
    cid: `cid-${n}`,
    author: { did: 'did:plc:alice', handle: 'alice.bsky.social' },
    record: { text: `Post ${n}`, createdAt: '2026-11-15T10:00:00.000Z' },
  },
});

const mockAgents: any[] = [];

jest.mock('@atproto/api', () => ({
  moderatePost: jest.requireActual('@atproto/api').moderatePost,
  BSKY_LABELER_DID: jest.requireActual('@atproto/api').BSKY_LABELER_DID,
  RichText: class {
    facets = undefined;
    text: string;
    constructor(input: { text: string }) {
      this.text = input.text;
    }
    detectFacets = jest.fn(async () => undefined);
  },
  AtpAgent: class {
    session: any = undefined;
    get did() {
      return this.session?.did;
    }
    login = jest.fn(async ({ identifier }: { identifier: string }) => {
      this.session = { did: 'did:plc:me', handle: identifier, accessJwt: 'a', refreshJwt: 'r', active: true };
      this.options.persistSession?.('create', this.session);
    });
    resumeSession = jest.fn(async (session: any) => {
      if (session.refreshJwt === 'expired') {
        this.options.persistSession?.('expired', undefined);
        throw new Error('ExpiredToken');
      }
      if (session.refreshJwt === 'offline') {
        this.options.persistSession?.('network-error', session);
        throw new TypeError('Network request failed');
      }
      this.session = session;
    });
    logout = jest.fn(async () => {
      this.session = undefined;
    });
    getTimeline = jest.fn(async () => ({ data: { feed: [feedItem(1), { post: {} }, feedItem(2)], cursor: 'next' } }));
    post = jest.fn(async () => ({ uri: 'at://new', cid: 'new-cid' }));
    like = jest.fn(async () => ({ uri: 'at://me/like/1', cid: 'like-cid' }));
    repost = jest.fn(async () => ({ uri: 'at://me/repost/1', cid: 'repost-cid' }));
    deleteLike = jest.fn(async () => undefined);
    deleteRepost = jest.fn(async () => undefined);
    deletePost = jest.fn(async () => undefined);
    getPosts = jest.fn(async () => ({ data: { posts: [{ viewer: { like: 'at://me/like/old', repost: undefined } }] } }));
    getAuthorFeed = jest.fn(async () => ({
      data: {
        feed: [
          { ...feedItem(5), reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:me', handle: 'me' } } },
          { post: { ...feedItem(6).post, author: { did: 'did:plc:me', handle: 'me.bsky.social' } } },
        ],
      },
    }));
    uploadBlob = jest.fn(async () => ({ data: { blob: { ref: 'blob' } } }));
    app = { bsky: { feed: { getFeed: jest.fn(async () => ({ data: { feed: [feedItem(9)] } })) } } };
    options: any;
    constructor(input: any) {
      this.options = input;
      mockAgents.push(this);
    }
  },
}));

function setup(store = createMemoryStore()) {
  mockAgents.length = 0;
  const provider = new BlueskyProvider({ store });
  const agent = mockAgents.find((candidate) => candidate.options.service === 'https://bsky.social');
  const publicAgent = mockAgents.find((candidate) => candidate.options.service === 'https://public.api.bsky.app');
  return { provider, store, agent, publicAgent };
}

describe('BlueskyProvider', () => {
  it('serves the public demo feed when signed out', async () => {
    const { provider, agent, publicAgent } = setup();
    const page = await provider.getTimeline({ limit: 5 });
    expect(page).toMatchObject({ posts: [{ uri: 'at://post/9' }], cursor: null });
    expect(publicAgent.app.bsky.feed.getFeed).toHaveBeenCalledWith(expect.objectContaining({ feed: expect.stringMatching(/^at:\/\//), limit: 5 }));
    expect(agent.getTimeline).not.toHaveBeenCalled();
  });

  it('signs in, stores the session and reads the home timeline with the cursor', async () => {
    const { provider, store, agent } = setup();
    expect(await signInWithKey(provider, ' @me.bsky.social ')).toEqual({ id: 'did:plc:me', handle: 'me.bsky.social' });
    expect(JSON.parse((await store.get('bluesky.session'))!)).toMatchObject({ did: 'did:plc:me', refreshJwt: 'r' });
    const page = await provider.getTimeline({ cursor: 'abc' });
    expect(agent.getTimeline).toHaveBeenCalledWith({ cursor: 'abc', limit: 30 });
    expect(page.posts.map((post) => post.uri)).toEqual(['at://post/1', 'at://post/2']);
    expect(page.cursor).toBe('next');
  });

  it('restores a stored session, and reports a missing one', async () => {
    const { provider, store } = setup();
    expect(await provider.restoreSession()).toEqual({ status: 'none' });
    expect(await provider.hasStoredSession()).toBe(false);
    await store.set('bluesky.session', JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'a', refreshJwt: 'r', active: true }));
    expect(await provider.hasStoredSession()).toBe(true);
    expect(await provider.restoreSession()).toEqual({ status: 'restored', account: { id: 'did:plc:me', handle: 'me.bsky.social' } });
  });

  it('reports a session the server refused as invalid and forgets it', async () => {
    const { provider, store } = setup();
    await store.set('bluesky.session', JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'a', refreshJwt: 'expired', active: true }));
    expect(await provider.restoreSession()).toEqual({ status: 'invalid', account: { id: 'did:plc:me', handle: 'me.bsky.social' } });
    expect(await store.get('bluesky.session')).toBeNull();
  });

  it('reports an unreachable server without touching the stored session', async () => {
    const { provider, store } = setup();
    const saved = JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'a', refreshJwt: 'offline', active: true });
    await store.set('bluesky.session', saved);
    expect(await provider.restoreSession()).toEqual({ status: 'unreachable' });
    expect(await store.get('bluesky.session')).toBe(saved);
    expect(await provider.hasStoredSession()).toBe(true);
  });

  it('clears the stored session on sign out', async () => {
    const { provider, store } = setup();
    await signInWithKey(provider, 'me.bsky.social');
    await provider.signOut();
    expect(await store.get('bluesky.session')).toBeNull();
  });

  it('signs out at once on a dead network, and a late logout never removes the next sign in', async () => {
    const { provider, store, agent } = setup();
    await signInWithKey(provider, 'me.bsky.social');
    let finishLogout = () => undefined as void;
    agent.logout.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = () => {
            agent.options.persistSession('expired', undefined);
            resolve();
          };
        }),
    );
    await provider.signOut();
    expect(await store.get('bluesky.session')).toBeNull();
    expect(await provider.restoreSession()).toEqual({ status: 'none' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(agent.logout).toHaveBeenCalledTimes(1);
    await signInWithKey(provider, 'me.bsky.social');
    finishLogout();
    await provider.revoking;
    expect(await store.get('bluesky.session')).not.toBeNull();
    expect((await provider.restoreSession()).status).toBe('restored');
  });

  it('posts with uploaded images and their alt text', async () => {
    const { provider, agent } = setup();
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })) as any;
    const image = await provider.uploadImage({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }, 'A sunset');
    expect(agent.uploadBlob).toHaveBeenCalledWith(expect.any(Uint8Array), { encoding: 'image/jpeg' });
    expect(await provider.createPost({ text: 'Look', images: [image] })).toEqual({ uri: 'at://new', cid: 'new-cid' });
    expect(agent.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Look', embed: { $type: 'app.bsky.embed.images', images: [{ alt: 'A sunset', image: { ref: 'blob' } }] } }),
    );
  });

  it('replies under the thread root, likes and reposts', async () => {
    const { provider, agent } = setup();
    const parent = (await provider.getTimeline()).posts[0];
    await provider.reply({ ...parent, replyRoot: { uri: 'at://root', cid: 'root-cid' } }, { text: 'Nice' });
    expect(agent.post).toHaveBeenCalledWith(
      expect.objectContaining({ reply: { root: { uri: 'at://root', cid: 'root-cid' }, parent: { uri: parent.uri, cid: parent.cid } } }),
    );
    await provider.reply(parent, { text: 'Top level reply' });
    expect(agent.post).toHaveBeenLastCalledWith(expect.objectContaining({ reply: { root: { uri: parent.uri, cid: parent.cid }, parent: { uri: parent.uri, cid: parent.cid } } }));
    await provider.like(parent);
    await provider.repost(parent);
    expect(agent.like).toHaveBeenCalledWith(parent.uri, parent.cid);
    expect(agent.repost).toHaveBeenCalledWith(parent.uri, parent.cid);
  });

  it('returns like and repost records and removes them, looking them up when not given', async () => {
    const { provider, agent } = setup();
    const post = { uri: 'at://post/1', cid: 'cid-1' };
    const like = await provider.like(post);
    expect(like).toEqual({ uri: 'at://me/like/1' });
    expect(await provider.unlike(post, like)).toBe(true);
    expect(agent.deleteLike).toHaveBeenLastCalledWith('at://me/like/1');
    expect(await provider.unlike(post)).toBe(true);
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: ['at://post/1'] });
    expect(agent.deleteLike).toHaveBeenLastCalledWith('at://me/like/old');
    expect(await provider.unrepost(post)).toBe(false);
    expect(await provider.unrepost(post, await provider.repost(post))).toBe(true);
    expect(agent.deleteRepost).toHaveBeenCalledWith('at://me/repost/1');
  });

  it("deletes a post and finds the signed-in user's latest own post, skipping reposts", async () => {
    const { provider, agent } = setup();
    expect(await provider.getMyLatestPost()).toBeNull();
    await signInWithKey(provider, 'me.bsky.social');
    const latest = await provider.getMyLatestPost();
    expect(agent.getAuthorFeed).toHaveBeenCalledWith({ actor: 'did:plc:me', limit: 10, filter: 'posts_with_replies' });
    expect(latest?.uri).toBe('at://post/6');
    await provider.deletePost({ uri: 'at://post/6', cid: 'cid-6' });
    expect(agent.deletePost).toHaveBeenCalledWith('at://post/6');
  });
});

describe('BlueskyProvider content filter', () => {
  const labeled = (n: number, val: string) => {
    const item = feedItem(n);
    return { post: { ...item.post, labels: [{ src: 'did:plc:ar7c4by46qjdydhdevvrndac', uri: item.post.uri, val, cts: '2026-11-15T10:00:00.000Z' }] } };
  };

  it('skips adult posts in the signed-out demo feed', async () => {
    const { provider, publicAgent } = setup();
    publicAgent.app.bsky.feed.getFeed.mockResolvedValueOnce({ data: { feed: [feedItem(1), labeled(2, 'porn'), labeled(3, 'sexual'), feedItem(4)], cursor: 'c' } });
    expect((await provider.getTimeline()).posts.map((post) => post.uri)).toEqual(['at://post/1', 'at://post/4']);
  });

  it('skips adult posts in the signed-in timeline too', async () => {
    const { provider, agent } = setup();
    await signInWithKey(provider, 'me.bsky.social');
    agent.getTimeline.mockResolvedValueOnce({ data: { feed: [labeled(1, 'nudity'), feedItem(2), labeled(3, 'graphic-media')], cursor: 'c' } });
    expect((await provider.getTimeline()).posts.map((post) => post.uri)).toEqual(['at://post/2']);
  });

  it('reads on when a whole page is filtered, instead of ending the feed', async () => {
    const { provider, publicAgent } = setup();
    publicAgent.app.bsky.feed.getFeed
      .mockResolvedValueOnce({ data: { feed: [labeled(1, 'porn')], cursor: 'c1' } })
      .mockResolvedValueOnce({ data: { feed: [feedItem(2)], cursor: 'c2' } });
    expect(await provider.getTimeline()).toMatchObject({ posts: [{ uri: 'at://post/2' }], cursor: 'c2' });
    expect(publicAgent.app.bsky.feed.getFeed).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
  });

  it('keeps reading past fully filtered pages, up to ten, before giving up without ending the feed', async () => {
    const { provider, publicAgent } = setup();
    const filtered = (n: number) => ({ data: { feed: [labeled(n, 'porn')], cursor: `c${n}` } });
    for (let n = 1; n <= 9; n += 1) publicAgent.app.bsky.feed.getFeed.mockResolvedValueOnce(filtered(n));
    publicAgent.app.bsky.feed.getFeed.mockResolvedValueOnce({ data: { feed: [feedItem(10)], cursor: 'c10' } });
    expect(await provider.getTimeline()).toMatchObject({ posts: [{ uri: 'at://post/10' }], cursor: 'c10' });

    publicAgent.app.bsky.feed.getFeed.mockClear();
    for (let n = 11; n <= 30; n += 1) publicAgent.app.bsky.feed.getFeed.mockResolvedValueOnce(filtered(n));
    expect(await provider.getTimeline({ cursor: 'c10' })).toEqual({ posts: [], cursor: 'c20' });
    expect(publicAgent.app.bsky.feed.getFeed).toHaveBeenCalledTimes(10);
  });
});
