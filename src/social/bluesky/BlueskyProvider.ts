import { Agent, AtpAgent, RichText, type AtpSessionData, type BlobRef } from '@atproto/api';
import { OAuthCallbackError, isExpectedSessionError, type OAuthSession } from '@atproto/oauth-client';

import type { KeyValueStore } from '@/storage/keyValueStore';

import type { NewPost, Post, PostRef, RecordRef, ReplyParent, RestoreResult, SignInResult, SocialAccount, SocialProvider, TimelinePage, UploadedImage } from '../types';
import { mapFeedItem } from './mapPost';
import { isHiddenByModeration } from './moderation';
import { NetworkError } from './oauth/createOAuthClient';
import { createBlueskyOAuth, type BlueskyOAuth, type BlueskyOAuthFactory } from './oauth';
import { OAUTH_SESSION_KEY } from './oauth/stores';

const SESSION_KEY = 'bluesky.session';
const OAUTH_ACCOUNT_KEY = 'bluesky.oauth.account';
const DEFAULT_SERVICE = 'https://bsky.social';
const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
const DEFAULT_OAUTH_ORIGIN = 'https://dependable-goshawk-583.convex.site';
const MAX_FILTERED_PAGES = 10;
const DEFAULT_DEMO_FEED = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

type Options = { store: KeyValueStore; service?: string; demoFeed?: string; oauthOrigin?: string; oauth?: BlueskyOAuthFactory };

type Signed = { kind: 'atp'; agent: AtpAgent } | { kind: 'oauth'; agent: Agent; account: SocialAccount };

export class SessionExpiredError extends Error {}

function isNetworkError(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof NetworkError) return true;
  }
  return false;
}

export class BlueskyProvider implements SocialProvider {
  readonly id = 'bluesky';
  readonly name = 'Bluesky';

  private readonly store: KeyValueStore;
  private readonly service: string;
  private readonly demoFeed: string;
  private readonly atpAgent: AtpAgent;
  private readonly publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });
  private readonly createOAuth: BlueskyOAuthFactory;
  private readonly expiryListeners = new Set<(account: SocialAccount) => void>();
  private oauthClient: BlueskyOAuth | null = null;
  private signed: Signed | null = null;
  private expired = false;
  private authorizing = false;
  private lastPersistEvent: string | null = null;

  constructor({ store, service, demoFeed, oauthOrigin, oauth }: Options) {
    this.store = store;
    this.service = service || DEFAULT_SERVICE;
    this.demoFeed = demoFeed || DEFAULT_DEMO_FEED;
    this.createOAuth = oauth ?? createBlueskyOAuth(oauthOrigin || DEFAULT_OAUTH_ORIGIN);
    this.atpAgent = new AtpAgent({
      service: this.service,
      persistSession: (event, session) => {
        this.lastPersistEvent = event;
        void (session ? store.set(SESSION_KEY, JSON.stringify(session)) : store.remove(SESSION_KEY));
      },
    });
  }

  async hasStoredSession(): Promise<boolean> {
    const [oauthAccount, saved] = await Promise.all([this.store.get(OAUTH_ACCOUNT_KEY), this.store.get(SESSION_KEY)]);
    return oauthAccount !== null || saved !== null;
  }

  async restoreSession(): Promise<RestoreResult> {
    const oauthAccount = await this.store.get(OAUTH_ACCOUNT_KEY);
    if (oauthAccount) {
      const account = JSON.parse(oauthAccount) as SocialAccount;
      try {
        const session = await this.oauth().client.restore(account.id);
        return { status: 'restored', account: this.useOAuth(account, session) };
      } catch (error) {
        if (!isExpectedSessionError(error)) return { status: 'unreachable' };
        await this.forgetOAuth();
        return { status: 'invalid', account };
      }
    }
    const saved = await this.store.get(SESSION_KEY);
    if (!saved) return { status: 'none' };
    const session = JSON.parse(saved) as AtpSessionData;
    this.lastPersistEvent = null;
    try {
      await this.atpAgent.resumeSession(session);
    } catch {
      if (this.lastPersistEvent !== 'expired') return { status: 'unreachable' };
      return { status: 'invalid', account: { id: session.did, handle: session.handle } };
    }
    const account = this.usePassword();
    return account ? { status: 'restored', account } : { status: 'invalid', account: { id: session.did, handle: session.handle } };
  }

  async findAccount(handle: string): Promise<boolean> {
    try {
      await this.oauth().client.identityResolver.resolve(handle);
      return true;
    } catch (error) {
      if (isNetworkError(error)) throw error;
      return false;
    }
  }

  signIn(handle: string): Promise<SignInResult> {
    return this.authorize(handle, {});
  }

  createAccount(): Promise<SignInResult> {
    return this.authorize(this.service, { prompt: 'create' });
  }

  async signInWithAppPassword(identifier: string, appPassword: string): Promise<SocialAccount> {
    await this.atpAgent.login({ identifier: identifier.trim().replace(/^@/, ''), password: appPassword });
    await this.forgetOAuth();
    const account = this.usePassword();
    if (!account) throw new Error('Sign in did not return a session');
    return account;
  }

  async signOut(): Promise<void> {
    const signed = this.signed;
    this.signed = null;
    this.expired = false;
    try {
      if (signed?.kind === 'atp') await signed.agent.logout();
      if (signed?.kind === 'oauth') await this.oauth().client.revoke(signed.account.id);
    } catch {
      // The server may be unreachable; the device copies are removed below either way.
    } finally {
      await Promise.all([SESSION_KEY, OAUTH_ACCOUNT_KEY, OAUTH_SESSION_KEY].map((key) => this.store.remove(key)));
    }
  }

  onSessionExpired(listener: (account: SocialAccount) => void): () => void {
    this.expiryListeners.add(listener);
    return () => void this.expiryListeners.delete(listener);
  }

  async getTimeline({ cursor, limit = 30 }: { cursor?: string; limit?: number } = {}): Promise<TimelinePage> {
    if (this.expired) throw new SessionExpiredError('The Bluesky session has ended');
    const agent = this.signed?.agent;
    let next = cursor;
    for (let attempt = 0; attempt < MAX_FILTERED_PAGES; attempt += 1) {
      const { data } = agent
        ? await agent.getTimeline({ cursor: next, limit })
        : await this.publicAgent.app.bsky.feed.getFeed({ feed: this.demoFeed, cursor: next, limit });
      const posts = data.feed
        .filter((item) => !isHiddenByModeration(item.post, agent?.did))
        .map(mapFeedItem)
        .filter((post): post is Post => post !== null);
      next = data.cursor;
      if (posts.length || !next) return { posts, cursor: next ?? null };
    }
    return { posts: [], cursor: next ?? null };
  }

  createPost(post: NewPost): Promise<PostRef> {
    return this.publish(post);
  }

  reply(parent: ReplyParent, post: NewPost): Promise<PostRef> {
    const parentRef = { uri: parent.uri, cid: parent.cid };
    return this.publish(post, { root: parent.replyRoot ?? parentRef, parent: parentRef });
  }

  async repost(post: PostRef): Promise<RecordRef> {
    const { uri } = await this.agent().repost(post.uri, post.cid);
    return { uri };
  }

  async like(post: PostRef): Promise<RecordRef> {
    const { uri } = await this.agent().like(post.uri, post.cid);
    return { uri };
  }

  async unlike(post: PostRef, like?: RecordRef): Promise<boolean> {
    const uri = like?.uri ?? (await this.viewerOf(post))?.like;
    if (!uri) return false;
    await this.agent().deleteLike(uri);
    return true;
  }

  async unrepost(post: PostRef, repost?: RecordRef): Promise<boolean> {
    const uri = repost?.uri ?? (await this.viewerOf(post))?.repost;
    if (!uri) return false;
    await this.agent().deleteRepost(uri);
    return true;
  }

  async deletePost(post: PostRef): Promise<void> {
    await this.agent().deletePost(post.uri);
  }

  async getMyLatestPost(): Promise<Post | null> {
    const did = this.signedDid();
    if (!did) return null;
    const { data } = await this.agent().getAuthorFeed({ actor: did, limit: 10, filter: 'posts_with_replies' });
    return data.feed.filter((item) => !item.reason).map(mapFeedItem).find((post) => post?.author.id === did) ?? null;
  }

  async uploadImage(image: { uri: string; mimeType: string }, alt: string): Promise<UploadedImage> {
    const bytes = new Uint8Array(await (await fetch(image.uri)).arrayBuffer());
    const { data } = await this.agent().uploadBlob(bytes, { encoding: image.mimeType });
    return { alt, handle: data.blob };
  }

  private async viewerOf(post: PostRef) {
    const { data } = await this.agent().getPosts({ uris: [post.uri] });
    return data.posts[0]?.viewer ?? null;
  }

  private signedDid(): string | null {
    if (this.signed?.kind === 'oauth') return this.signed.account.id;
    return this.signed?.agent.did ?? null;
  }

  private agent(): Agent {
    if (this.expired) throw new SessionExpiredError('The Bluesky session has ended');
    return this.signed?.agent ?? this.atpAgent;
  }

  private oauth(): BlueskyOAuth {
    this.oauthClient ??= this.createOAuth({ store: this.store, onSessionDeleted: (sub) => void this.expire(sub) });
    return this.oauthClient;
  }

  private usePassword(): SocialAccount | null {
    const session = this.atpAgent.session;
    if (!session) return null;
    this.signed = { kind: 'atp', agent: this.atpAgent };
    this.expired = false;
    return { id: session.did, handle: session.handle };
  }

  private useOAuth(account: SocialAccount, session?: OAuthSession): SocialAccount {
    let pending: Promise<OAuthSession> | null = session ? Promise.resolve(session) : null;
    const fetchHandler = async (url: string, init: RequestInit) => {
      pending ??= this.oauth()
        .client.restore(account.id)
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
      return (await pending).fetchHandler(url, init);
    };
    this.signed = { kind: 'oauth', account, agent: new Agent({ did: account.id, fetchHandler }) };
    this.expired = false;
    return account;
  }

  private async expire(sub: string): Promise<void> {
    const signed = this.signed;
    if (this.authorizing || signed?.kind !== 'oauth' || signed.account.id !== sub) return;
    this.signed = null;
    this.expired = true;
    await Promise.all([this.store.remove(OAUTH_ACCOUNT_KEY), this.store.remove(OAUTH_SESSION_KEY)]);
    this.expiryListeners.forEach((listener) => listener(signed.account));
  }

  private async forgetOAuth(): Promise<void> {
    await Promise.all([this.store.remove(OAUTH_ACCOUNT_KEY), this.store.remove(OAUTH_SESSION_KEY)]);
  }

  private async authorize(input: string, options: { prompt?: 'create' }): Promise<SignInResult> {
    const oauth = this.oauth();
    this.authorizing = true;
    try {
      const url = await oauth.client.authorize(input, { ...options, display: 'touch' });
      const result = await oauth.openAuthSession(url.toString(), oauth.redirectUri);
      if (result.type !== 'success' || !result.url) return { status: 'cancelled' };
      const { session } = await oauth.client.callback(new URL(result.url).searchParams, { redirect_uri: oauth.redirectUri });
      return { status: 'success', account: await this.adoptOAuth(session) };
    } catch (error) {
      if (error instanceof OAuthCallbackError && error.params.get('error') === 'access_denied') return { status: 'cancelled' };
      return { status: 'failed', reason: isNetworkError(error) ? 'network' : 'server' };
    } finally {
      this.authorizing = false;
    }
  }

  private async adoptOAuth(session: OAuthSession): Promise<SocialAccount> {
    await this.store.remove(SESSION_KEY);
    this.useOAuth({ id: session.did, handle: session.did }, session);
    const agent = this.agent();
    const [profile, identity] = await Promise.all([
      agent.getProfile({ actor: session.did }).then(({ data }) => data, () => null),
      this.oauth().client.identityResolver.resolve(session.did).catch(() => null),
    ]);
    const handle = profile?.handle ?? (identity && identity.handle !== 'handle.invalid' ? identity.handle : session.did);
    const account: SocialAccount = { id: session.did, handle, displayName: profile?.displayName || null };
    if (this.signed?.kind === 'oauth') this.signed.account = account;
    await this.store.set(OAUTH_ACCOUNT_KEY, JSON.stringify(account));
    return account;
  }

  private async publish({ text, images }: NewPost, reply?: { root: PostRef; parent: PostRef }): Promise<PostRef> {
    const richText = new RichText({ text });
    await richText.detectFacets(this.publicAgent);
    return this.agent().post({
      text: richText.text,
      facets: richText.facets,
      reply,
      embed: images?.length
        ? { $type: 'app.bsky.embed.images', images: images.map((image) => ({ alt: image.alt, image: image.handle as BlobRef })) }
        : undefined,
    });
  }
}
