import type { KeyValueStore } from '@/storage/keyValueStore';

import type { LookDescription } from './lookClient';

// Walking the photo library one photo at a time, newest first. Each photo is described when the user reaches
// it, and the next two in the background, so moving on rarely waits. Descriptions are cached on the phone by
// the photo's identifier, in memory and in local storage, so a photo is never described twice; the server keeps
// nothing.

// uri is the library's own (ph://) address, only for showing the photo on screen.
export type LibraryPhoto = { id: string; uri: string; takenAt: number; width: number; height: number };

export type LibrarySource = {
  recent(count: number): Promise<LibraryPhoto[]>;
  // A downscaled base64 JPEG of the photo, ready to be described.
  image(photo: LibraryPhoto): Promise<string | null>;
};

export type Described = Pick<LookDescription, 'description' | 'altText' | 'visibleText'>;

export const LIBRARY = { pageSize: 60, prefetch: 2, cacheEntries: 300, cacheKey: 'camera.libraryDescriptions' };

export class DescriptionStore {
  private entries: Map<string, Described> | null = null;
  private loading: Promise<Map<string, Described>> | null = null;

  constructor(private readonly store: KeyValueStore) {}

  async get(id: string): Promise<Described | null> {
    return (await this.load()).get(id) ?? null;
  }

  async set(id: string, described: Described): Promise<void> {
    const entries = await this.load();
    entries.delete(id);
    entries.set(id, described);
    while (entries.size > LIBRARY.cacheEntries) entries.delete(entries.keys().next().value as string);
    await this.store.set(LIBRARY.cacheKey, JSON.stringify([...entries])).catch(() => undefined);
  }

  private load(): Promise<Map<string, Described>> {
    if (this.entries) return Promise.resolve(this.entries);
    this.loading ??= this.store
      .get(LIBRARY.cacheKey)
      .catch(() => null)
      .then((raw) => {
        let parsed: [string, Described][] = [];
        try {
          parsed = raw ? (JSON.parse(raw) as [string, Described][]) : [];
        } catch {
          parsed = [];
        }
        this.entries = new Map(parsed);
        return this.entries;
      });
    return this.loading;
  }
}

export type Move = 'moved' | 'atStart' | 'atEnd';

export class LibraryWalk {
  private photos: LibraryPhoto[] = [];
  private index = 0;
  private readonly inflight = new Map<string, Promise<Described | null>>();

  constructor(
    private readonly deps: {
      source: LibrarySource;
      store: DescriptionStore;
      // null when descriptions are off (the user declined sending pictures) or the service failed.
      describe(image: string): Promise<Described | null>;
      allowed(): boolean;
    },
  ) {}

  async load(): Promise<number> {
    this.photos = await this.deps.source.recent(LIBRARY.pageSize);
    this.index = 0;
    return this.photos.length;
  }

  get count(): number {
    return this.photos.length;
  }

  get position(): number {
    return this.index;
  }

  current(): LibraryPhoto | null {
    return this.photos[this.index] ?? null;
  }

  move(direction: 'older' | 'newer'): Move {
    const next = this.index + (direction === 'older' ? 1 : -1);
    if (next < 0) return 'atStart';
    if (next >= this.photos.length) return 'atEnd';
    this.index = next;
    return 'moved';
  }

  // The current photo's description, fetching it if needed, and the next ones in the background.
  async describeCurrent(): Promise<Described | null> {
    const photo = this.current();
    if (!photo) return null;
    const described = this.describe(photo);
    this.photos.slice(this.index + 1, this.index + 1 + LIBRARY.prefetch).forEach((next) => void this.describe(next));
    return described;
  }

  cached(photo: LibraryPhoto): Promise<Described | null> {
    return this.deps.store.get(photo.id);
  }

  private describe(photo: LibraryPhoto): Promise<Described | null> {
    const running = this.inflight.get(photo.id);
    if (running) return running;
    const request = (async () => {
      const cached = await this.deps.store.get(photo.id);
      if (cached || !this.deps.allowed()) return cached;
      const image = await this.deps.source.image(photo);
      const described = image ? await this.deps.describe(image).catch(() => null) : null;
      if (described) await this.deps.store.set(photo.id, described);
      return described;
    })().finally(() => this.inflight.delete(photo.id));
    this.inflight.set(photo.id, request);
    return request;
  }
}
