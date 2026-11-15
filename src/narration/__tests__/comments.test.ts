import type { Reply } from '@/social/types';
import { makePost } from '@/testing/fixtures';

import { buildPostScript } from '../buildNarration';
import { buildReplyScript, commentsEntry } from '../comments';

const now = new Date('2026-11-15T12:00:00.000Z');
const maya = { id: 'did:maya', handle: 'maya.bsky.social', displayName: 'Maya', avatarUrl: null };
const sam = { id: 'did:sam', handle: 'sam.bsky.social', displayName: null, avatarUrl: null };

describe('comments narration', () => {
  it('ends a post with its reply count only when it has replies', () => {
    const post = makePost({ author: maya, text: 'Hello', createdAt: '2026-11-15T11:00:00.000Z' });
    expect(buildPostScript({ ...post, counts: { likes: 0, reposts: 0, replies: 12 } }, { now })).toBe('Maya, 1 hour ago. Hello. 12 replies.');
    expect(buildPostScript({ ...post, counts: { likes: 0, reposts: 0, replies: 1 } }, { now, mode: 'brief' })).toBe('Maya. Hello. 1 reply.');
    expect(buildPostScript(post, { now })).toBe('Maya, 1 hour ago. Hello.');
  });

  it('says how many replies there are and how to leave, in one short sentence', () => {
    expect(commentsEntry(12)).toBe('12 replies. Swipe down to go back.');
    expect(commentsEntry(1)).toBe('1 reply. Swipe down to go back.');
    expect(commentsEntry(0)).toBe('No replies yet. Swipe down to go back.');
    expect(commentsEntry(3, 'Most people agree.')).toBe('3 replies. Most people agree. Swipe down to go back.');
  });

  it('reads a reply with its position, its author and who it answers, then by the same rules as a post', () => {
    const top: Reply = { ...makePost({ author: maya, text: 'Great shot' }), parentAuthor: null, counts: { likes: 0, reposts: 0, replies: 4 } };
    const nested: Reply = {
      ...makePost({ author: maya, text: 'Thanks!', media: [{ kind: 'images', images: [{ url: 'x', alt: 'A dog' }] }], replyTo: { authorName: 'sam', isSelf: false } }),
      parentAuthor: sam,
    };
    expect(buildReplyScript(top, 1, 12, { now })).toBe('Reply 2 of 12, from Maya. Great shot.');
    expect(buildReplyScript(nested, 2, 12, { now })).toBe('Reply 3 of 12, from Maya, replying to sam. Thanks! One image: A dog.');
    expect(buildReplyScript(nested, 2, 12, { now, mode: 'brief' })).toBe('Reply 3 of 12, from Maya, replying to sam. Thanks! Has an image.');
  });
});
