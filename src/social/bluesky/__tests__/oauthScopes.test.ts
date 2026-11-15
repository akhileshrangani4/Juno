import { OAUTH_SCOPES, oauthClientMetadata, oauthScopes } from '../../../../convex/oauthClientMetadata';
import { MEMORY_METHOD, memoryAudience } from '../../../../convex/memoryService';
import { PermissionMissingError, type SocialProvider } from '../../types';
import { BlueskyProvider } from '../BlueskyProvider';
import type { BlueskyOAuth } from '../oauth';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';
const APPVIEW = 'did:web:api.bsky.app%23bsky_appview';
const DISCOVER = 'did:web:discover.bsky.app%23bsky_fg';
const LIKE = `at://${DID}/app.bsky.feed.like/3kaaaaaaaaaaa`;
const REPOST = `at://${DID}/app.bsky.feed.repost/3kaaaaaaaaaab`;

type Request = { nsid: string; params: URLSearchParams; body: any; contentType: string | null; proxy: string | null };

const ORIGIN = 'https://dependable-goshawk-583.convex.site';
const MEMORY_AUDIENCE = memoryAudience(ORIGIN);
const SCOPES = oauthScopes(ORIGIN);

const postView = (n: number) => ({
  uri: `at://${DID}/app.bsky.feed.post/${n}`,
  cid: CID,
  author: { did: DID, handle: 'maya.bsky.social' },
  record: { $type: 'app.bsky.feed.post', text: `Post ${n}`, createdAt: '2026-11-15T10:00:00.000Z' },
  indexedAt: '2026-11-15T10:00:00.000Z',
  viewer: { like: LIKE, repost: REPOST },
});

const responses: Record<string, (body: any) => unknown> = {
  'app.bsky.actor.getProfile': () => ({ did: DID, handle: 'maya.bsky.social', displayName: 'Maya' }),
  'app.bsky.feed.getTimeline': () => ({ feed: [{ post: postView(1) }] }),
  'app.bsky.feed.getFeed': () => ({ feed: [{ post: postView(3), feedContext: 'ctx-3', reqId: 'req-1' }] }),
  'app.bsky.feed.sendInteractions': () => ({}),
  'app.bsky.feed.getAuthorFeed': () => ({ feed: [{ post: postView(2) }] }),
  'app.bsky.feed.getPosts': () => ({ posts: [postView(1)] }),
  'app.bsky.feed.getPostThread': () => ({ thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: postView(1), replies: [] } }),
  'com.atproto.repo.createRecord': (body) => ({ uri: `at://${DID}/${body.collection}/3kaaaaaaaaaac`, cid: CID }),
  'com.atproto.repo.deleteRecord': () => ({}),
  'com.atproto.server.getServiceAuth': () => ({ token: 'proof' }),
  'com.atproto.repo.uploadBlob': () => ({ blob: { $type: 'blob', ref: { $link: CID }, mimeType: 'image/jpeg', size: 4 } }),
};

// A service-auth token is granted by the rpc scope of the method and audience it is for, not by the method
// that fetches it (https://atproto.com/specs/permission).
function scopeFor({ nsid, params, body, contentType, proxy }: Request): string {
  if (nsid === 'com.atproto.server.getServiceAuth') return `rpc:${params.get('lxm')}?aud=${params.get('aud')}`;
  if (nsid === 'com.atproto.repo.createRecord') return `repo:${body.collection}?action=create`;
  if (nsid === 'com.atproto.repo.putRecord') return `repo:${body.collection}?action=update`;
  if (nsid === 'com.atproto.repo.deleteRecord') return `repo:${body.collection}?action=delete`;
  if (nsid === 'com.atproto.repo.uploadBlob') return `blob:${contentType}`;
  return `rpc:${nsid}?aud=${proxy ? proxy.replace('#', '%23') : APPVIEW}`;
}

function granted(scope: string): boolean {
  if (scope.startsWith('blob:')) {
    const mime = scope.slice('blob:'.length);
    return SCOPES.some((candidate) => candidate.startsWith('blob:') && new RegExp(`^${candidate.slice(5).replace('*', '[^/]+')}$`).test(mime));
  }
  return SCOPES.includes(scope.replace('#', '%23'));
}

async function signedIn() {
  const requests: Request[] = [];
  const session = {
    did: DID,
    fetchHandler: async (path: string, init: RequestInit) => {
      const [route, query] = path.split('?');
      const nsid = route.replace('/xrpc/', '');
      const contentType = new Headers(init.headers).get('content-type');
      const raw = init.body instanceof Uint8Array && contentType === 'application/json' ? new TextDecoder().decode(init.body) : init.body;
      const body = typeof raw === 'string' ? JSON.parse(raw) : undefined;
      requests.push({ nsid, params: new URLSearchParams(query), body, contentType, proxy: new Headers(init.headers).get('atproto-proxy') });
      const respond = responses[nsid];
      if (!respond) throw new Error(`No fake response for ${nsid}`);
      const result = respond(body);
      return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const client = {
    authorize: async () => new URL('https://bsky.social/oauth/authorize?request_uri=req-1'),
    callback: async () => ({ session, state: null }),
    restore: async () => session,
    revoke: async () => undefined,
    identityResolver: { resolve: async () => ({ did: DID, handle: 'maya.bsky.social' }) },
  };
  const values = new Map<string, string>();
  const provider = new BlueskyProvider({
    store: { get: async (key) => values.get(key) ?? null, set: async (key, value) => void values.set(key, value), remove: async (key) => void values.delete(key) },
    oauth: () => ({
      client: client as unknown as BlueskyOAuth['client'],
      redirectUri: 'com.example:/oauth/callback',
      openAuthSession: async () => ({ type: 'success', url: 'com.example:/oauth/callback?code=c&state=s&iss=https%3A%2F%2Fbsky.social' }),
    }),
  });
  await provider.signIn('maya.bsky.social');
  return { provider, requests };
}

const post = { uri: `at://${DID}/app.bsky.feed.post/1`, cid: CID };

const everyMethod: Record<Exclude<keyof SocialProvider, 'id' | 'name'>, (provider: BlueskyProvider) => Promise<unknown>> = {
  hasStoredSession: (provider) => provider.hasStoredSession(),
  restoreSession: (provider) => provider.restoreSession(),
  findAccount: (provider) => provider.findAccount('maya.bsky.social'),
  signIn: (provider) => provider.signIn('maya.bsky.social'),
  createAccount: (provider) => provider.createAccount(),
  signInWithAppPassword: async () => 'App-password sessions are not OAuth sessions and need no OAuth scope.',
  signOut: (provider) => provider.signOut(),
  onSessionExpired: async (provider) => provider.onSessionExpired(() => undefined)(),
  getTimeline: async (provider) => [await provider.getTimeline({ feed: 'forYou' }), await provider.getTimeline({ feed: 'following' })],
  sendFeedFeedback: async (provider) => {
    const [forYou] = (await provider.getTimeline({ feed: 'forYou' })).posts;
    return provider.sendFeedFeedback(forYou, 'more');
  },
  createPost: (provider) => provider.createPost({ text: 'Hello' }),
  repost: (provider) => provider.repost(post),
  like: (provider) => provider.like(post),
  reply: (provider) => provider.reply({ ...post, replyRoot: null }, { text: 'Hi' }),
  uploadImage: async (provider) => {
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })) as unknown as typeof fetch;
    return provider.uploadImage({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }, 'A sunset');
  },
  unlike: async (provider) => [await provider.unlike(post, { uri: LIKE }), await provider.unlike(post)],
  unrepost: async (provider) => [await provider.unrepost(post, { uri: REPOST }), await provider.unrepost(post)],
  deletePost: (provider) => provider.deletePost(post),
  getMyLatestPost: (provider) => provider.getMyLatestPost(),
  serviceAuth: (provider) => provider.serviceAuth({ aud: MEMORY_AUDIENCE, lxm: MEMORY_METHOD }),
  getReplies: (provider) => provider.getReplies(post.uri),
};

describe('OAuth scopes', () => {
  it.each(Object.entries(everyMethod))('grant every Bluesky call %s makes under an OAuth session', async (_method, run) => {
    const { provider, requests } = await signedIn();
    requests.length = 0;
    await run(provider);
    const missing = requests.map(scopeFor).filter((scope) => !granted(scope));
    expect(missing).toEqual([]);
  });

  it('cover the calls that need them, so the table above is checking real requests', async () => {
    const seen = new Set<string>();
    for (const run of Object.values(everyMethod)) {
      const { provider, requests } = await signedIn();
      requests.length = 0;
      await run(provider);
      requests.forEach((request) => seen.add(scopeFor(request)));
    }
    expect([...seen].sort()).toEqual(
      [
        'blob:image/jpeg',
        'repo:app.bsky.feed.like?action=create',
        'repo:app.bsky.feed.like?action=delete',
        'repo:app.bsky.feed.post?action=create',
        'repo:app.bsky.feed.post?action=delete',
        'repo:app.bsky.feed.repost?action=create',
        'repo:app.bsky.feed.repost?action=delete',
        `rpc:app.bsky.actor.getProfile?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getAuthorFeed?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getPostThread?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getPosts?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getTimeline?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getFeed?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.sendInteractions?aud=${DISCOVER}`,
        `rpc:${MEMORY_METHOD}?aud=${MEMORY_AUDIENCE}`,
      ].sort(),
    );
  });

  it('pin the memory proof to the deployment that serves the metadata', () => {
    expect(SCOPES.at(-1)).toBe(`rpc:${MEMORY_METHOD}?aud=did:web:dependable-goshawk-583.convex.site%23juno_memory`);
    expect(oauthClientMetadata(ORIGIN).scope.split(' ')).toEqual(SCOPES);
    expect(oauthScopes('https://other-deployment-1.convex.site').at(-1)).toBe(`rpc:${MEMORY_METHOD}?aud=did:web:other-deployment-1.convex.site%23juno_memory`);
  });

  it('grant a photo post from the camera: the upload with its alt text, then the post that embeds it', async () => {
    const { provider, requests } = await signedIn();
    requests.length = 0;
    globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })) as unknown as typeof fetch;
    const image = await provider.uploadImage({ uri: 'file:///upload.jpg', mimeType: 'image/jpeg' }, 'A red mug on a desk.');
    await provider.createPost({ text: '', images: [image] });
    expect(requests.map(scopeFor)).toEqual(['blob:image/jpeg', 'repo:app.bsky.feed.post?action=create']);
    expect(requests.map(scopeFor).filter((scope) => !granted(scope))).toEqual([]);
    expect(requests[1].body.record.embed.images[0].alt).toBe('A red mug on a desk.');
  });

  it('ask for nothing beyond those calls', () => {
    expect(OAUTH_SCOPES).toEqual([
      'atproto',
      'repo:app.bsky.feed.post?action=create',
      'repo:app.bsky.feed.post?action=delete',
      'repo:app.bsky.feed.like?action=create',
      'repo:app.bsky.feed.like?action=delete',
      'repo:app.bsky.feed.repost?action=create',
      'repo:app.bsky.feed.repost?action=delete',
      'blob:image/*',
      `rpc:app.bsky.feed.getTimeline?aud=${APPVIEW}`,
      `rpc:app.bsky.feed.getAuthorFeed?aud=${APPVIEW}`,
      `rpc:app.bsky.feed.getPosts?aud=${APPVIEW}`,
      `rpc:app.bsky.feed.getPostThread?aud=${APPVIEW}`,
      `rpc:app.bsky.actor.getProfile?aud=${APPVIEW}`,
      `rpc:app.bsky.feed.getFeed?aud=${APPVIEW}`,
      `rpc:app.bsky.feed.sendInteractions?aud=${DISCOVER}`,
    ]);
  });
});

describe('the two feeds', () => {
  it('read For You as the user, with what its feedback needs, and Following from the timeline', async () => {
    const { provider, requests } = await signedIn();
    requests.length = 0;
    const forYou = await provider.getTimeline({ feed: 'forYou' });
    const following = await provider.getTimeline({ feed: 'following' });
    expect(requests.map((request) => request.nsid)).toEqual(['app.bsky.feed.getFeed', 'app.bsky.feed.getTimeline']);
    expect(requests[0].params.get('feed')).toBe('at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot');
    expect(forYou.posts[0].feedContext).toEqual({ context: 'ctx-3', reqId: 'req-1' });
    expect(following.posts[0].feedContext).toBeUndefined();
  });

  it('send a For You post feedback to the Discover feed, and nothing for any other post', async () => {
    const { provider, requests } = await signedIn();
    const [forYou] = (await provider.getTimeline({ feed: 'forYou' })).posts;
    const [following] = (await provider.getTimeline({ feed: 'following' })).posts;
    requests.length = 0;
    await provider.sendFeedFeedback(forYou, 'more');
    await provider.sendFeedFeedback(forYou, 'less');
    await provider.sendFeedFeedback(forYou, 'like');
    await provider.sendFeedFeedback(following, 'more');
    expect(requests.map((request) => request.proxy)).toEqual(Array(3).fill('did:web:discover.bsky.app#bsky_fg'));
    expect(requests.map((request) => request.body)).toEqual(
      ['requestMore', 'requestLess', 'interactionLike'].map((event) => ({
        feed: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
        interactions: [{ item: forYou.uri, event: `app.bsky.feed.defs#${event}`, feedContext: 'ctx-3', reqId: 'req-1' }],
      })),
    );
  });

  it('fall back to the public Discover feed for a sign-in made before the For You permission', async () => {
    const original = responses['app.bsky.feed.getFeed'];
    responses['app.bsky.feed.getFeed'] = () =>
      new Response(JSON.stringify({ error: 'ScopeMissingError', message: 'Missing required scope "rpc:app.bsky.feed.getFeed"' }), { status: 403, headers: { 'content-type': 'application/json' } });
    const publicFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ feed: [{ post: postView(4), feedContext: 'ctx-4' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    publicFetch.mockClear();
    try {
      const { provider } = await signedIn();
      const page = await provider.getTimeline({ feed: 'forYou' });
      expect(page.posts.map((post) => post.uri)).toEqual([postView(4).uri]);
      expect(page.posts[0].feedContext).toBeUndefined();
      expect((publicFetch.mock.calls[0][0] as unknown as { url: string }).url).toContain('public.api.bsky.app/xrpc/app.bsky.feed.getFeed');
    } finally {
      responses['app.bsky.feed.getFeed'] = original;
      publicFetch.mockRestore();
    }
  });
});

describe('an OAuth sign-in made before the memory scope', () => {
  it('is told apart from any other failure, so the agent can ask the user to sign in again', async () => {
    const original = responses['com.atproto.server.getServiceAuth'];
    responses['com.atproto.server.getServiceAuth'] = () =>
      new Response(JSON.stringify({ error: 'ScopeMissingError', message: `Missing required scope "rpc:${MEMORY_METHOD}?aud=${MEMORY_AUDIENCE}"` }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const { provider } = await signedIn();
      await expect(provider.serviceAuth({ aud: MEMORY_AUDIENCE, lxm: MEMORY_METHOD })).rejects.toBeInstanceOf(PermissionMissingError);
    } finally {
      responses['com.atproto.server.getServiceAuth'] = original;
    }
  });
});
