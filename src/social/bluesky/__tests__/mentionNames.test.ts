import { makePost } from '@/testing/fixtures';

import { withMentionNames } from '../mentionNames';

const mention = (did: string) => ({ start: 0, end: 4, kind: 'mention' as const, did, name: null });

describe('withMentionNames', () => {
  it('fills mention names from one batched profile lookup', async () => {
    const posts = [makePost({ facets: [mention('did:a')] }), makePost({ facets: [mention('did:b'), mention('did:a')] }), makePost()];
    const lookup = jest.fn(async () => [{ did: 'did:a', displayName: 'Maya' }, { did: 'did:b', displayName: ' ' }]);
    const named = await withMentionNames(posts, lookup);
    expect(lookup).toHaveBeenCalledWith(['did:a', 'did:b']);
    expect(named[0].facets).toEqual([{ ...mention('did:a'), name: 'Maya' }]);
    expect(named[1].facets).toEqual([mention('did:b'), { ...mention('did:a'), name: 'Maya' }]);
    expect(named[2]).toBe(posts[2]);
  });

  it('leaves posts alone when there are no mentions, the lookup fails, or it is slow', async () => {
    const plain = [makePost()];
    const lookup = jest.fn();
    expect(await withMentionNames(plain, lookup)).toBe(plain);
    expect(lookup).not.toHaveBeenCalled();
    const posts = [makePost({ facets: [mention('did:a')] })];
    expect(await withMentionNames(posts, async () => Promise.reject(new Error('down')))).toBe(posts);
    expect(await withMentionNames(posts, () => new Promise(() => undefined), 10)).toBe(posts);
  });
});
