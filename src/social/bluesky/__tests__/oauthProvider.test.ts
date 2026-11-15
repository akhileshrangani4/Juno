import { OAuthCallbackError, TokenRefreshError } from '@atproto/oauth-client';

import type { KeyValueStore } from '@/storage/keyValueStore';

import { OfflineError } from '../../types';
import { BlueskyProvider, SessionExpiredError } from '../BlueskyProvider';
import { NetworkError } from '../oauth/createOAuthClient';
import type { BlueskyOAuth } from '../oauth';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';
const REDIRECT = 'com.example.juno:/oauth/callback';

function trackingStore(): KeyValueStore & { keys(): string[] } {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
    keys: () => [...values.keys()],
  };
}

const postView = (n: number) => ({
  uri: `at://${DID}/app.bsky.feed.post/${n}`,
  cid: CID,
  author: { did: DID, handle: 'maya.bsky.social' },
  record: { $type: 'app.bsky.feed.post', text: `Post ${n}`, createdAt: '2026-11-15T10:00:00.000Z' },
  indexedAt: '2026-11-15T10:00:00.000Z',
});

function fakeSession() {
  const requests: { path: string; method: string; body: any }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  return {
    requests,
    session: {
      did: DID,
      fetchHandler: jest.fn(async (path: string, init: RequestInit) => {
        const raw = init.body instanceof Uint8Array && init.headers && new Headers(init.headers).get('content-type') === 'application/json' ? new TextDecoder().decode(init.body) : init.body;
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        requests.push({ path, method: init.method ?? 'GET', body });
        const endpoint = path.split('?')[0];
        if (endpoint === '/xrpc/app.bsky.actor.getProfile') return json({ did: DID, handle: 'maya.bsky.social', displayName: 'Maya' });
        if (endpoint === '/xrpc/app.bsky.feed.getTimeline') return json({ feed: [{ post: postView(1) }, { post: postView(2) }], cursor: 'next' });
        if (endpoint === '/xrpc/com.atproto.repo.createRecord') return json({ uri: `at://${DID}/${body.collection}/1`, cid: CID });
        if (endpoint === '/xrpc/com.atproto.repo.uploadBlob') return json({ blob: { $type: 'blob', ref: { $link: CID }, mimeType: 'image/jpeg', size: 4 } });
        throw new Error(`Unexpected request ${path}`);
      }),
    },
  };
}

function setup(store = trackingStore()) {
  const { session, requests } = fakeSession();
  let onSessionDeleted: (sub: string) => void = () => undefined;
  const client = {
    authorize: jest.fn(async () => new URL('https://bsky.social/oauth/authorize?request_uri=req-1')),
    callback: jest.fn(async (_params: URLSearchParams) => ({ session, state: null })),
    restore: jest.fn(async () => session),
    revoke: jest.fn(async () => undefined),
    identityResolver: { resolve: jest.fn(async () => ({ did: DID, handle: 'maya.bsky.social' })) },
  };
  const openAuthSession = jest.fn(async () => ({ type: 'success', url: `${REDIRECT}?code=c&state=s&iss=https%3A%2F%2Fbsky.social` }));
  const factoryStores: KeyValueStore[] = [];
  const provider = new BlueskyProvider({
    store,
    oauth: (options) => {
      factoryStores.push(options.store);
      if (options.store === store) onSessionDeleted = options.onSessionDeleted;
      return { client: client as unknown as BlueskyOAuth['client'], redirectUri: REDIRECT, openAuthSession };
    },
  });
  return { provider, store, client, openAuthSession, session, requests, factoryStores, deleteSession: (sub: string) => onSessionDeleted(sub) };
}

describe('BlueskyProvider with OAuth', () => {
  it("signs in on Bluesky's own page and names the account", async () => {
    const { provider, store, client, openAuthSession } = setup();
    await store.set('bluesky.session', '{"stale":"app password session"}');
    expect(await provider.signIn('maya.bsky.social')).toEqual({ status: 'success', account: { id: DID, handle: 'maya.bsky.social', displayName: 'Maya' } });
    expect(client.authorize).toHaveBeenCalledWith('maya.bsky.social', { display: 'touch' });
    expect(openAuthSession).toHaveBeenCalledWith('https://bsky.social/oauth/authorize?request_uri=req-1', REDIRECT);
    expect(client.callback.mock.calls[0][0].get('code')).toBe('c');
    expect(store.keys()).toEqual(['bluesky.oauth.account']);
  });

  it('runs every SocialProvider call through the OAuth session', async () => {
    const { provider, requests } = setup();
    await provider.signIn('maya.bsky.social');
    const page = await provider.getTimeline({ limit: 5 });
    expect(page.posts.map((post) => post.text)).toEqual(['Post 1', 'Post 2']);
    expect(page.cursor).toBe('next');
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })) as any;
    const image = await provider.uploadImage({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }, 'A sunset');
    await provider.createPost({ text: 'Look', images: [image] });
    await provider.reply(page.posts[0], { text: 'Nice' });
    await provider.like(page.posts[0]);
    await provider.repost(page.posts[0]);
    expect(requests.map(({ path, body }) => `${path.split('?')[0]} ${body?.collection ?? ''}`.trim())).toEqual([
      '/xrpc/app.bsky.actor.getProfile',
      '/xrpc/app.bsky.feed.getTimeline',
      '/xrpc/com.atproto.repo.uploadBlob',
      '/xrpc/com.atproto.repo.createRecord app.bsky.feed.post',
      '/xrpc/com.atproto.repo.createRecord app.bsky.feed.post',
      '/xrpc/com.atproto.repo.createRecord app.bsky.feed.like',
      '/xrpc/com.atproto.repo.createRecord app.bsky.feed.repost',
    ]);
    expect(requests[3].body.record.embed.images[0].alt).toBe('A sunset');
    expect(requests[4].body.record.reply.parent.uri).toBe(page.posts[0].uri);
  });

  it('reports a like that gets no answer as offline and keeps the user signed in', async () => {
    const { provider, store, session } = setup();
    await provider.signIn('maya.bsky.social');
    const expired = jest.fn();
    provider.onSessionExpired(expired);
    const [post] = (await provider.getTimeline()).posts;
    session.fetchHandler.mockRejectedValueOnce(new NetworkError('Could not reach the server', { cause: new TypeError('Network request failed') }));
    await expect(provider.like(post)).rejects.toBeInstanceOf(OfflineError);
    session.fetchHandler.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(provider.unlike(post, { uri: `at://${DID}/app.bsky.feed.like/1` })).rejects.toBeInstanceOf(OfflineError);
    expect(expired).not.toHaveBeenCalled();
    expect(store.keys()).toContain('bluesky.oauth.account');
    expect(await provider.like(post)).toEqual({ uri: `at://${DID}/app.bsky.feed.like/1` });
  });

  it('treats a dismissed sheet and a denied request as a cancel', async () => {
    const dismissed = setup();
    dismissed.openAuthSession.mockResolvedValueOnce({ type: 'cancel' } as any);
    expect(await dismissed.provider.signIn('maya.bsky.social')).toEqual({ status: 'cancelled' });
    expect(dismissed.client.callback).not.toHaveBeenCalled();
    const denied = setup();
    denied.client.callback.mockRejectedValueOnce(new OAuthCallbackError(new URLSearchParams({ error: 'access_denied' })));
    expect(await denied.provider.signIn('maya.bsky.social')).toEqual({ status: 'cancelled' });
    expect(denied.store.keys()).toEqual([]);
  });

  it('tells a network failure from a server failure', async () => {
    const offline = setup();
    offline.client.authorize.mockRejectedValueOnce(new Error('Failed to resolve identity', { cause: new NetworkError('down') }));
    expect(await offline.provider.signIn('maya.bsky.social')).toEqual({ status: 'failed', reason: 'network' });
    const refused = setup();
    refused.client.callback.mockRejectedValueOnce(new OAuthCallbackError(new URLSearchParams({ error: 'invalid_request' })));
    expect(await refused.provider.signIn('maya.bsky.social')).toEqual({ status: 'failed', reason: 'server' });
  });

  it('finds an account, reports a missing one, and passes on network errors', async () => {
    const { provider, client } = setup();
    expect(await provider.findAccount('maya.bsky.social')).toBe(true);
    client.identityResolver.resolve.mockRejectedValueOnce(new Error('Handle could not be resolved'));
    expect(await provider.findAccount('nobody.bsky.social')).toBe(false);
    client.identityResolver.resolve.mockRejectedValueOnce(new Error('lookup', { cause: new NetworkError('down') }));
    await expect(provider.findAccount('maya.bsky.social')).rejects.toThrow('lookup');
  });

  it('starts account creation on Bluesky with the create prompt', async () => {
    const { provider, client } = setup();
    expect(await provider.createAccount()).toMatchObject({ status: 'success', account: { id: DID } });
    expect(client.authorize).toHaveBeenCalledWith('https://bsky.social', { prompt: 'create', display: 'touch' });
  });

  it('restores after a relaunch by resuming the session once', async () => {
    const first = setup();
    await first.provider.signIn('maya.bsky.social');
    const relaunch = setup(first.store);
    expect(await relaunch.provider.hasStoredSession()).toBe(true);
    expect(await relaunch.provider.restoreSession()).toEqual({ status: 'restored', account: { id: DID, handle: 'maya.bsky.social', displayName: 'Maya' } });
    await relaunch.provider.getTimeline();
    await relaunch.provider.getTimeline();
    expect(relaunch.client.restore).toHaveBeenCalledTimes(1);
    expect(relaunch.client.restore).toHaveBeenCalledWith(DID);
  });

  it('reports an unreachable server without touching the stored session, and restores on retry', async () => {
    const first = setup();
    await first.provider.signIn('maya.bsky.social');
    const relaunch = setup(first.store);
    relaunch.client.restore.mockRejectedValueOnce(new Error('Failed to fetch server metadata', { cause: new NetworkError('down') }));
    expect(await relaunch.provider.restoreSession()).toEqual({ status: 'unreachable' });
    expect(relaunch.store.keys()).toEqual(['bluesky.oauth.account']);
    expect(await relaunch.provider.restoreSession()).toMatchObject({ status: 'restored', account: { id: DID } });
  });

  it('reports a session the server refused as invalid, names the account and forgets it', async () => {
    const first = setup();
    await first.provider.signIn('maya.bsky.social');
    await first.store.set('bluesky.oauth.session', '{"sub":"did","dpopJwk":{},"tokenSet":{}}');
    const relaunch = setup(first.store);
    const expired = jest.fn();
    relaunch.provider.onSessionExpired(expired);
    relaunch.client.restore.mockRejectedValueOnce(new TokenRefreshError(DID, 'The session was revoked'));
    expect(await relaunch.provider.restoreSession()).toEqual({ status: 'invalid', account: { id: DID, handle: 'maya.bsky.social', displayName: 'Maya' } });
    expect(relaunch.store.keys()).toEqual([]);
    expect(expired).not.toHaveBeenCalled();
  });

  it('announces an unrecoverable session once, forgets it, and stops serving the timeline', async () => {
    const first = setup();
    await first.provider.signIn('maya.bsky.social');
    const relaunch = setup(first.store);
    await relaunch.provider.restoreSession();
    const expired = jest.fn();
    relaunch.provider.onSessionExpired(expired);
    relaunch.session.fetchHandler.mockImplementationOnce(async () => {
      relaunch.deleteSession(DID);
      throw new TokenRefreshError(DID, 'The session was revoked');
    });
    await expect(relaunch.provider.getTimeline()).rejects.toThrow();
    await Promise.resolve();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith({ id: DID, handle: 'maya.bsky.social', displayName: 'Maya' });
    await expect(relaunch.provider.getTimeline()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(relaunch.store.keys()).toEqual([]);
    expect(await relaunch.provider.signIn('maya.bsky.social')).toMatchObject({ status: 'success' });
    expect((await relaunch.provider.getTimeline()).posts).toHaveLength(2);
  });

  it('ignores the deletion the library reports while a new sign in replaces the old session', async () => {
    const { provider, client, deleteSession } = setup();
    const expired = jest.fn();
    provider.onSessionExpired(expired);
    await provider.signIn('maya.bsky.social');
    client.callback.mockImplementationOnce(async () => {
      deleteSession(DID);
      return { session: (await client.restore()) as any, state: null };
    });
    await provider.signIn('maya.bsky.social');
    expect(expired).not.toHaveBeenCalled();
  });

  it('signs out by removing every stored token and key first, then revoking in the background', async () => {
    const { provider, store, client, factoryStores } = setup();
    await provider.signIn('maya.bsky.social');
    const saved = '{"sub":"did","dpopJwk":{},"tokenSet":{}}';
    await store.set('bluesky.oauth.session', saved);
    client.revoke.mockRejectedValueOnce(new NetworkError('down'));
    await provider.signOut();
    expect(store.keys()).toEqual([]);
    await provider.revoking;
    expect(client.revoke).toHaveBeenCalledWith(DID);
    expect(await factoryStores.at(-1)!.get('bluesky.oauth.session')).toBe(saved);
    expect(await provider.restoreSession()).toEqual({ status: 'none' });
  });

  it('signs out at once when the network never answers, and gives up on the revoke after five seconds', async () => {
    jest.useFakeTimers();
    try {
      const { provider, store, client } = setup();
      await provider.signIn('maya.bsky.social');
      await store.set('bluesky.oauth.session', '{"sub":"did","dpopJwk":{},"tokenSet":{}}');
      client.revoke.mockImplementationOnce(() => new Promise(() => undefined));
      await provider.signOut();
      expect(store.keys()).toEqual([]);
      let settled = false;
      void provider.revoking.then(() => (settled = true));
      await jest.advanceTimersByTimeAsync(4900);
      expect(client.revoke).toHaveBeenCalledWith(DID);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(200);
      expect(settled).toBe(true);
      expect(await provider.signIn('maya.bsky.social')).toMatchObject({ status: 'success' });
    } finally {
      jest.useRealTimers();
    }
  });
});
