import type { Post } from '@/social/types';

import { descriptionInput, needsDescription, textNeedsTranslation, type DescriptionParts, type DetailLevel, type TranslationState } from './buildNarration';
import { languagesKey, translationCheck, type Languages } from './language';

export type Describe = (uri: string, detail: DetailLevel, languages: Languages | null) => Promise<DescriptionParts | null>;

const MAX_ENTRIES = 300;
const RETRY_AFTER_MS = 2 * 60 * 1000;

type Entry = { parts: DescriptionParts | null; at: number };

// Descriptions and translations on the device, keyed by post, detail level and the user's languages, so a change
// of languages never serves an answer made for the old ones.
export class DescriptionCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<DescriptionParts | null>>();

  constructor(
    private readonly describe: Describe,
    private readonly clock: () => number = Date.now,
    private readonly languages: () => Languages | null = () => null,
  ) {}

  peek(post: Post, detail: DetailLevel): DescriptionParts | null {
    return this.entries.get(this.key(post, detail))?.parts ?? null;
  }

  // Whether the post's text may be in a language the user does not read (src/narration/language.ts).
  mayNeedTranslation(post: Post): boolean {
    return textNeedsTranslation(descriptionInput(post), this.languages());
  }

  // The languages go to the server only when the post's text or its alt text may need translating. Every other
  // post is asked about exactly as before translation existed, so its description is shared by every listener and
  // the request works against a deployment from before translation.
  private languagesFor(post: Post): Languages | null {
    const languages = this.languages();
    if (!languages || this.mayNeedTranslation(post)) return languages;
    const { images, video } = descriptionInput(post);
    const alts = [...images.map((image) => image.alt), video?.alt].filter((alt): alt is string => !!alt);
    return alts.some((alt) => translationCheck(alt, [], languages).candidate) ? languages : null;
  }

  // For a post that may need translating and has no answer yet: whether one is on its way, or the last try failed.
  translationState(post: Post, detail: DetailLevel): TranslationState {
    if (!this.mayNeedTranslation(post)) return null;
    const entry = this.entries.get(this.key(post, detail));
    if (entry?.parts) return null;
    return entry && !this.inflight.has(this.key(post, detail)) ? 'failed' : 'pending';
  }

  // With translationOnly (brief and verbatim readings), a post is asked about only when its text may need translating.
  request(post: Post, detail: DetailLevel, { translationOnly = false }: { translationOnly?: boolean } = {}): Promise<DescriptionParts | null> {
    const wanted = this.mayNeedTranslation(post) || (!translationOnly && needsDescription(post));
    if (!wanted) return Promise.resolve(null);
    const key = this.key(post, detail);
    const entry = this.entries.get(key);
    if (entry && (entry.parts || this.clock() - entry.at < RETRY_AFTER_MS)) return Promise.resolve(entry.parts);
    const running = this.inflight.get(key);
    if (running) return running;
    const request = this.describe(post.uri, detail, this.languagesFor(post))
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

  prefetch(posts: Post[], detail: DetailLevel, options?: { translationOnly?: boolean }): void {
    posts.forEach((post) => void this.request(post, detail, options));
  }

  private key(post: Post, detail: DetailLevel) {
    return `${detail}:${languagesKey(this.languages())}:${post.uri}`;
  }
}
