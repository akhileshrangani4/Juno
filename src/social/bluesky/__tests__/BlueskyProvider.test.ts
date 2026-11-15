import { createMemoryStore } from '@/storage/keyValueStore';

import { BlueskyProvider } from '../BlueskyProvider';

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
    login = jest.fn(async ({ identifier }: { identifier: string }) => {
      this.session = { did: 'did:plc:me', handle: identifier, accessJwt: 'a', refreshJwt: 'r', active: true };
      this.options.persistSession?.('create', this.session);
    });
    resumeSession = jest.fn(async (session: any) => {
      if (session.refreshJwt === 'expired') throw new Error('expired');
      this.session = session;
    });
    logout = jest.fn(async () => {
      this.session = undefined;
    });
    getTimeline = jest.fn(async () => ({ data: { feed: [feedItem(1), { post: {} }, feedItem(2)], cursor: 'next' } }));
    post = jest.fn(async () => ({ uri: 'at://new', cid: 'new-cid' }));
    like = jest.fn(async () => ({}));
    repost = jest.fn(async () => ({}));
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
    expect(await provider.signIn(' @me.bsky.social ', 'app-password')).toEqual({ id: 'did:plc:me', handle: 'me.bsky.social' });
    expect(JSON.parse((await store.get('bluesky.session'))!)).toMatchObject({ did: 'did:plc:me', refreshJwt: 'r' });
    const page = await provider.getTimeline({ cursor: 'abc' });
    expect(agent.getTimeline).toHaveBeenCalledWith({ cursor: 'abc', limit: 30 });
    expect(page.posts.map((post) => post.uri)).toEqual(['at://post/1', 'at://post/2']);
    expect(page.cursor).toBe('next');
  });

  it('restores a stored session and survives a missing or expired one', async () => {
    const { provider, store } = setup();
    expect(await provider.restoreSession()).toBeNull();
    await store.set('bluesky.session', JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social', accessJwt: 'a', refreshJwt: 'r', active: true }));
    expect(await provider.restoreSession()).toEqual({ id: 'did:plc:me', handle: 'me.bsky.social' });
    const expired = setup();
    await expired.store.set('bluesky.session', JSON.stringify({ did: 'd', handle: 'h', accessJwt: 'a', refreshJwt: 'expired', active: true }));
    expect(await expired.provider.restoreSession()).toBeNull();
  });

  it('clears the stored session on sign out', async () => {
    const { provider, store } = setup();
    await provider.signIn('me.bsky.social', 'pw');
    await provider.signOut();
    expect(await store.get('bluesky.session')).toBeNull();
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
});
