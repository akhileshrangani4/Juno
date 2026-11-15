import { OAUTH_SCOPES } from '../../../../convex/oauthClientMetadata';
import { MEMORY_METHOD, memoryAudience } from '../../../../convex/memoryService';
import type { SocialProvider } from '../../types';
import { BlueskyProvider } from '../BlueskyProvider';
import type { BlueskyOAuth } from '../oauth';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';
const APPVIEW = 'did:web:api.bsky.app%23bsky_appview';
const LIKE = `at://${DID}/app.bsky.feed.like/3kaaaaaaaaaaa`;
const REPOST = `at://${DID}/app.bsky.feed.repost/3kaaaaaaaaaab`;

type Request = { nsid: string; params: URLSearchParams; body: any; contentType: string | null };

const MEMORY_AUDIENCE = memoryAudience('https://dependable-goshawk-583.convex.site');

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
function scopeFor({ nsid, params, body, contentType }: Request): string {
  if (nsid === 'com.atproto.server.getServiceAuth') return `rpc:${params.get('lxm')}?aud=${params.get('aud')}`;
  if (nsid === 'com.atproto.repo.createRecord') return `repo:${body.collection}?action=create`;
  if (nsid === 'com.atproto.repo.putRecord') return `repo:${body.collection}?action=update`;
  if (nsid === 'com.atproto.repo.deleteRecord') return `repo:${body.collection}?action=delete`;
  if (nsid === 'com.atproto.repo.uploadBlob') return `blob:${contentType}`;
  return `rpc:${nsid}?aud=${APPVIEW}`;
}

function granted(scope: string): boolean {
  if (scope.startsWith('blob:')) {
    const mime = scope.slice('blob:'.length);
    return OAUTH_SCOPES.some((candidate) => candidate.startsWith('blob:') && new RegExp(`^${candidate.slice(5).replace('*', '[^/]+')}$`).test(mime));
  }
  return OAUTH_SCOPES.includes(scope) || (scope.startsWith('rpc:') && OAUTH_SCOPES.includes(scope.replace(/\?aud=.*$/, '?aud=*')));
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
      requests.push({ nsid, params: new URLSearchParams(query), body, contentType });
      const respond = responses[nsid];
      if (!respond) throw new Error(`No fake response for ${nsid}`);
      return new Response(JSON.stringify(respond(body)), { status: 200, headers: { 'content-type': 'application/json' } });
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
  getTimeline: (provider) => provider.getTimeline(),
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
        `rpc:app.bsky.feed.getPosts?aud=${APPVIEW}`,
        `rpc:app.bsky.feed.getTimeline?aud=${APPVIEW}`,
        `rpc:${MEMORY_METHOD}?aud=${MEMORY_AUDIENCE}`,
      ].sort(),
    );
  });

  it('ask for nothing beyond those calls, the post thread read that comments will use, and the memory proof', () => {
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
      `rpc:${MEMORY_METHOD}?aud=*`,
    ]);
  });
});
