import { AtpAgent, RichText, type AtpSessionData, type BlobRef } from '@atproto/api';

import type { KeyValueStore } from '@/storage/keyValueStore';

import type { NewPost, Post, PostRef, RecordRef, ReplyParent, SocialAccount, SocialProvider, TimelinePage, UploadedImage } from '../types';
import { mapFeedItem } from './mapPost';
import { withMentionNames } from './mentionNames';
import { isHiddenByModeration } from './moderation';

const SESSION_KEY = 'bluesky.session';
const DEFAULT_SERVICE = 'https://bsky.social';
const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
const MAX_FILTERED_PAGES = 10;
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

  async hasStoredSession(): Promise<boolean> {
    return (await this.store.get(SESSION_KEY)) !== null;
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
    let next = cursor;
    for (let attempt = 0; attempt < MAX_FILTERED_PAGES; attempt += 1) {
      const { data } = this.agent.session
        ? await this.agent.getTimeline({ cursor: next, limit })
        : await this.publicAgent.app.bsky.feed.getFeed({ feed: this.demoFeed, cursor: next, limit });
      const posts = data.feed
        .filter((item) => !isHiddenByModeration(item.post, this.agent.session?.did))
        .map(mapFeedItem)
        .filter((post): post is Post => post !== null);
      next = data.cursor;
      if (posts.length || !next) {
        return {
          posts: await withMentionNames(posts, (actors) => this.publicAgent.app.bsky.actor.getProfiles({ actors }).then(({ data }) => data.profiles)),
          cursor: next ?? null,
        };
      }
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
    const { uri } = await this.agent.repost(post.uri, post.cid);
    return { uri };
  }

  async like(post: PostRef): Promise<RecordRef> {
    const { uri } = await this.agent.like(post.uri, post.cid);
    return { uri };
  }

  async unlike(post: PostRef, like?: RecordRef): Promise<boolean> {
    const uri = like?.uri ?? (await this.viewerOf(post))?.like;
    if (!uri) return false;
    await this.agent.deleteLike(uri);
    return true;
  }

  async unrepost(post: PostRef, repost?: RecordRef): Promise<boolean> {
    const uri = repost?.uri ?? (await this.viewerOf(post))?.repost;
    if (!uri) return false;
    await this.agent.deleteRepost(uri);
    return true;
  }

  async deletePost(post: PostRef): Promise<void> {
    await this.agent.deletePost(post.uri);
  }

  async getMyLatestPost(): Promise<Post | null> {
    const did = this.agent.session?.did;
    if (!did) return null;
    const { data } = await this.agent.getAuthorFeed({ actor: did, limit: 10, filter: 'posts_with_replies' });
    return data.feed.filter((item) => !item.reason).map(mapFeedItem).find((post) => post?.author.id === did) ?? null;
  }

  async uploadImage(image: { uri: string; mimeType: string }, alt: string): Promise<UploadedImage> {
    const bytes = new Uint8Array(await (await fetch(image.uri)).arrayBuffer());
    const { data } = await this.agent.uploadBlob(bytes, { encoding: image.mimeType });
    return { alt, handle: data.blob };
  }

  private async viewerOf(post: PostRef) {
    const { data } = await this.agent.getPosts({ uris: [post.uri] });
    return data.posts[0]?.viewer ?? null;
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
