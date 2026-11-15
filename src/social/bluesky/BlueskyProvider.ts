import { AtpAgent, RichText, type AtpSessionData, type BlobRef } from '@atproto/api';

import type { KeyValueStore } from '@/storage/keyValueStore';

import type { NewPost, Post, PostRef, SocialAccount, SocialProvider, TimelinePage, UploadedImage } from '../types';
import { mapFeedItem } from './mapPost';

const SESSION_KEY = 'bluesky.session';
const DEFAULT_SERVICE = 'https://bsky.social';
const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
const DEFAULT_DEMO_FEED = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

type Options = { store: KeyValueStore; service?: string; demoFeed?: string };

export class BlueskyProvider implements SocialProvider {
  readonly id = 'bluesky';
  readonly name = 'Bluesky';

  private readonly store: KeyValueStore;
  private readonly demoFeed: string;
  private readonly agent: AtpAgent;
  private readonly publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });

  constructor({ store, service, demoFeed }: Options) {
    this.store = store;
    this.demoFeed = demoFeed || DEFAULT_DEMO_FEED;
    this.agent = new AtpAgent({
      service: service || DEFAULT_SERVICE,
      persistSession: (_event, session) => {
        void (session ? store.set(SESSION_KEY, JSON.stringify(session)) : store.remove(SESSION_KEY));
      },
    });
  }

  async restoreSession(): Promise<SocialAccount | null> {
    const saved = await this.store.get(SESSION_KEY);
    if (!saved) return null;
    try {
      await this.agent.resumeSession(JSON.parse(saved) as AtpSessionData);
    } catch {
      return null;
    }
    return this.account();
  }

  async signIn(identifier: string, password: string): Promise<SocialAccount> {
    await this.agent.login({ identifier: identifier.trim().replace(/^@/, ''), password });
    const account = this.account();
    if (!account) throw new Error('Sign in did not return a session');
    return account;
  }

  async signOut(): Promise<void> {
    try {
      await this.agent.logout();
    } finally {
      await this.store.remove(SESSION_KEY);
    }
  }

  async getTimeline({ cursor, limit = 30 }: { cursor?: string; limit?: number } = {}): Promise<TimelinePage> {
    const { data } = this.agent.session
      ? await this.agent.getTimeline({ cursor, limit })
      : await this.publicAgent.app.bsky.feed.getFeed({ feed: this.demoFeed, cursor, limit });
    return {
      posts: data.feed.map(mapFeedItem).filter((post): post is Post => post !== null),
      cursor: data.cursor ?? null,
    };
  }

  createPost(post: NewPost): Promise<PostRef> {
    return this.publish(post);
  }

  reply(parent: Post, post: NewPost): Promise<PostRef> {
    const parentRef = { uri: parent.uri, cid: parent.cid };
    return this.publish(post, { root: parent.replyRoot ?? parentRef, parent: parentRef });
  }

  async repost(post: PostRef): Promise<void> {
    await this.agent.repost(post.uri, post.cid);
  }

  async like(post: PostRef): Promise<void> {
    await this.agent.like(post.uri, post.cid);
  }

  async uploadImage(image: { uri: string; mimeType: string }, alt: string): Promise<UploadedImage> {
    const bytes = new Uint8Array(await (await fetch(image.uri)).arrayBuffer());
    const { data } = await this.agent.uploadBlob(bytes, { encoding: image.mimeType });
    return { alt, handle: data.blob };
  }

  private account(): SocialAccount | null {
    const session = this.agent.session;
    return session ? { id: session.did, handle: session.handle } : null;
  }

  private async publish({ text, images }: NewPost, reply?: { root: PostRef; parent: PostRef }): Promise<PostRef> {
    const richText = new RichText({ text });
    await richText.detectFacets(this.agent);
    return this.agent.post({
      text: richText.text,
      facets: richText.facets,
      reply,
      embed: images?.length
        ? { $type: 'app.bsky.embed.images', images: images.map((image) => ({ alt: image.alt, image: image.handle as BlobRef })) }
        : undefined,
    });
  }
}
