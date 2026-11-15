import { createMemoryStore } from '@/storage/keyValueStore';

import { DescriptionStore, LIBRARY, LibraryWalk, type LibraryPhoto, type LibrarySource } from '../library';

const photos: LibraryPhoto[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, uri: `ph://p${i}`, takenAt: 1_000 - i, width: 4000, height: 3000 }));

function setup({ allowed = true, store = createMemoryStore() } = {}) {
  const source: jest.Mocked<LibrarySource> = { recent: jest.fn<Promise<LibraryPhoto[]>, [number]>(async () => photos), image: jest.fn(async (photo) => `jpeg-of-${photo.id}`) };
  const describe = jest.fn(async (image: string) => ({ description: `Described ${image}`, altText: `Alt ${image}`, visibleText: [] }));
  const walk = new LibraryWalk({ source, store: new DescriptionStore(store), describe, allowed: () => allowed });
  return { walk, source, describe, store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('walking the photo library', () => {
  it('starts at the newest photo and moves one at a time, stopping at either end', async () => {
    const { walk } = setup();
    expect(await walk.load()).toBe(6);
    expect(walk.current()?.id).toBe('p0');
    expect(walk.move('newer')).toBe('atStart');
    expect(walk.move('older')).toBe('moved');
    expect(walk.current()?.id).toBe('p1');
    for (let i = 0; i < 4; i++) walk.move('older');
    expect(walk.move('older')).toBe('atEnd');
    expect(walk.current()?.id).toBe('p5');
  });

  it('describes the photo reached and prefetches the next two', async () => {
    const { walk, describe } = setup();
    await walk.load();
    const described = await walk.describeCurrent();
    await flush();
    expect(described?.description).toBe('Described jpeg-of-p0');
    expect(describe.mock.calls.map(([image]) => image).sort()).toEqual(['jpeg-of-p0', 'jpeg-of-p1', 'jpeg-of-p2']);
    expect(LIBRARY.prefetch).toBe(2);
  });

  it('never describes a photo twice: moving on uses what was prefetched, and going back uses the cache', async () => {
    const { walk, describe } = setup();
    await walk.load();
    await walk.describeCurrent();
    walk.move('older');
    await walk.describeCurrent();
    walk.move('newer');
    await walk.describeCurrent();
    await flush();
    expect(describe.mock.calls.map(([image]) => image).sort()).toEqual(['jpeg-of-p0', 'jpeg-of-p1', 'jpeg-of-p2', 'jpeg-of-p3']);
  });

  it('keeps descriptions on the phone across visits, keyed by the photo id', async () => {
    const first = setup();
    await first.walk.load();
    await first.walk.describeCurrent();
    await flush();
    const second = setup({ store: first.store });
    await second.walk.load();
    expect((await second.walk.describeCurrent())?.description).toBe('Described jpeg-of-p0');
    await flush();
    expect(second.describe.mock.calls.map(([image]) => image)).not.toContain('jpeg-of-p0');
    expect(JSON.parse((await first.store.get(LIBRARY.cacheKey))!)[0][0]).toBe('p0');
  });

  it('sends nothing when descriptions are off', async () => {
    const { walk, describe, source } = setup({ allowed: false });
    await walk.load();
    expect(await walk.describeCurrent()).toBeNull();
    expect(describe).not.toHaveBeenCalled();
    expect(source.image).not.toHaveBeenCalled();
  });

  it('asks only once for a photo already on its way', async () => {
    const { walk, describe } = setup();
    await walk.load();
    await Promise.all([walk.describeCurrent(), walk.describeCurrent()]);
    await flush();
    expect(describe.mock.calls.filter(([image]) => image === 'jpeg-of-p0')).toHaveLength(1);
  });
});
