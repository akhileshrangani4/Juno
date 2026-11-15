import type { Post } from '@/social/types';

import { needsDescription, type DescriptionParts, type DetailLevel } from './buildNarration';

export type Describe = (uri: string, detail: DetailLevel) => Promise<DescriptionParts | null>;

const MAX_ENTRIES = 300;
const RETRY_AFTER_MS = 2 * 60 * 1000;

type Entry = { parts: DescriptionParts | null; at: number };

export class DescriptionCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<DescriptionParts | null>>();

  constructor(
    private readonly describe: Describe,
    private readonly clock: () => number = Date.now,
  ) {}

  peek(post: Post, detail: DetailLevel): DescriptionParts | null {
    return this.entries.get(this.key(post, detail))?.parts ?? null;
  }

  request(post: Post, detail: DetailLevel): Promise<DescriptionParts | null> {
    if (!needsDescription(post)) return Promise.resolve(null);
    const key = this.key(post, detail);
    const entry = this.entries.get(key);
    if (entry && (entry.parts || this.clock() - entry.at < RETRY_AFTER_MS)) return Promise.resolve(entry.parts);
    const running = this.inflight.get(key);
    if (running) return running;
    const request = this.describe(post.uri, detail)
      .catch(() => null)
      .then((parts) => {
        this.inflight.delete(key);
        this.entries.delete(key);
        this.entries.set(key, { parts, at: this.clock() });
        if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
        return parts;
      });
    this.inflight.set(key, request);
    return request;
  }

  prefetch(posts: Post[], detail: DetailLevel): void {
    posts.forEach((post) => void this.request(post, detail));
  }

  private key(post: Post, detail: DetailLevel) {
    return `${detail}:${post.uri}`;
  }
}
