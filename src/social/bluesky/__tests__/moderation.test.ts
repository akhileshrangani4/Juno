import type { AppBskyFeedDefs } from '@atproto/api';

import { isHiddenByModeration } from '../moderation';

const label = (val: string, src = 'did:plc:ar7c4by46qjdydhdevvrndac') => ({ src, uri: 'at://did:plc:alice/app.bsky.feed.post/1', val, cts: '2026-11-15T10:00:00.000Z' });

function post(labels: ReturnType<typeof label>[] = [], authorLabels: ReturnType<typeof label>[] = []): AppBskyFeedDefs.PostView {
  return {
    uri: 'at://did:plc:alice/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: { did: 'did:plc:alice', handle: 'alice.bsky.social', labels: authorLabels },
    record: { $type: 'app.bsky.feed.post', text: 'Hello', createdAt: '2026-11-15T10:00:00.000Z' },
    indexedAt: '2026-11-15T10:00:00.000Z',
    labels,
  } as AppBskyFeedDefs.PostView;
}

describe('isHiddenByModeration', () => {
  it('keeps posts without labels, signed in or not', () => {
    expect(isHiddenByModeration(post(), undefined)).toBe(false);
    expect(isHiddenByModeration(post(), 'did:plc:me')).toBe(false);
  });

  it.each(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'suggestive', 'sexual-figurative'])('hides posts labeled %s, signed in or not', (value) => {
    expect(isHiddenByModeration(post([label(value)]), undefined)).toBe(true);
    expect(isHiddenByModeration(post([label(value)]), 'did:plc:me')).toBe(true);
  });

  it('hides posts whose author self-labels as adult', () => {
    expect(isHiddenByModeration(post([label('porn', 'did:plc:alice')]), undefined)).toBe(true);
  });

  it('respects authors who opted out of signed-out viewing', () => {
    expect(isHiddenByModeration(post([], [label('!no-unauthenticated', 'did:plc:alice')]), undefined)).toBe(true);
  });
});
