import { makePost } from '@/testing/fixtures';

import type { DescriptionParts } from '../buildNarration';
import { DescriptionCache } from '../descriptions';

const withImage = (uri = 'at://p/1') => makePost({ uri, media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });
const parts: DescriptionParts = { images: [{ description: 'A cat', beyondAlt: '' }], video: null, hashtagTopic: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('DescriptionCache', () => {
  it('makes no call at all for a post with no media and no hashtag pile', async () => {
    const describe = jest.fn();
    const cache = new DescriptionCache(describe);
    await expect(cache.request(makePost({ text: 'Just words #one #two' }), 'standard')).resolves.toBeNull();
    expect(describe).not.toHaveBeenCalled();
  });

  it('makes one call for concurrent requests for the same post and detail', async () => {
    const pending = deferred<DescriptionParts | null>();
    const describe = jest.fn(() => pending.promise);
    const cache = new DescriptionCache(describe);
    const post = withImage();
    const requests = [cache.request(post, 'standard'), cache.request(post, 'standard'), cache.request(post, 'standard')];
    expect(cache.peek(post, 'standard')).toBeNull();
    pending.resolve(parts);
    await expect(Promise.all(requests)).resolves.toEqual([parts, parts, parts]);
    expect(describe).toHaveBeenCalledTimes(1);
  });

  it('serves the cached parts afterwards without calling again, per detail level', async () => {
    const describe = jest.fn(async () => parts);
    const cache = new DescriptionCache(describe);
    const post = withImage();
    await cache.request(post, 'standard');
    expect(cache.peek(post, 'standard')).toEqual(parts);
    expect(cache.peek(post, 'detailed')).toBeNull();
    await cache.request(post, 'standard');
    expect(describe).toHaveBeenCalledTimes(1);
    await cache.request(post, 'detailed');
    expect(describe).toHaveBeenCalledTimes(2);
    expect(describe).toHaveBeenLastCalledWith('at://p/1', 'detailed', null);
  });

  it('turns a failure into null and retries only after two minutes', async () => {
    let clock = 0;
    const describe = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null).mockResolvedValue(parts);
    const cache = new DescriptionCache(describe, () => clock);
    const post = withImage();
    await expect(cache.request(post, 'standard')).resolves.toBeNull();
    clock = 60_000;
    await expect(cache.request(post, 'standard')).resolves.toBeNull();
    expect(describe).toHaveBeenCalledTimes(1);
    clock = 121_000;
    await expect(cache.request(post, 'standard')).resolves.toBeNull();
    clock = 250_000;
    await expect(cache.request(post, 'standard')).resolves.toEqual(parts);
    expect(describe).toHaveBeenCalledTimes(3);
  });

  it('prefetches each post once', async () => {
    const describe = jest.fn(async () => parts);
    const cache = new DescriptionCache(describe);
    const posts = [withImage('at://p/1'), withImage('at://p/2'), makePost({ uri: 'at://p/3' })];
    cache.prefetch(posts, 'standard');
    cache.prefetch(posts, 'standard');
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(describe).toHaveBeenCalledTimes(2);
  });
});
