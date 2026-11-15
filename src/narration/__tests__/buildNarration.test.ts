import { makePost } from '@/testing/fixtures';

import { buildPostNarration, formatAge, introInstructions, speakableText } from '../buildNarration';

const now = new Date('2026-11-15T12:00:00.000Z');

describe('formatAge', () => {
  it.each([
    ['2026-11-15T11:59:40.000Z', 'just now'],
    ['2026-11-15T11:59:00.000Z', '1 minute ago'],
    ['2026-11-15T11:15:00.000Z', '45 minutes ago'],
    ['2026-11-15T11:00:00.000Z', '1 hour ago'],
    ['2026-11-15T03:00:00.000Z', '9 hours ago'],
    ['2026-11-14T10:00:00.000Z', 'yesterday'],
    ['2026-11-12T10:00:00.000Z', '3 days ago'],
    ['2026-03-04T10:00:00.000Z', 'on March 4'],
    ['2024-03-04T10:00:00.000Z', 'on March 4, 2024'],
    ['2026-11-15T12:05:00.000Z', 'just now'],
    ['not a date', 'some time ago'],
  ])('%s is %s', (createdAt, expected) => {
    expect(formatAge(createdAt, now)).toBe(expected);
  });
});

describe('speakableText', () => {
  it('replaces URLs with their site and collapses whitespace', () => {
    expect(speakableText('Read this\n\nhttps://www.example.com/a/b?c=1  now')).toBe('Read this link to example.com now');
  });
});

describe('buildPostNarration', () => {
  it('reads author, age and text', () => {
    expect(buildPostNarration(makePost(), now)).toBe('Alice Chen, 2 hours ago. Hello world.');
  });

  it('does not double the final punctuation', () => {
    expect(buildPostNarration(makePost({ text: 'Really?' }), now)).toBe('Alice Chen, 2 hours ago. Really?');
  });

  it('falls back to the handle without the bsky.social suffix', () => {
    const post = makePost({ author: { id: 'did:plc:a', handle: 'alice.bsky.social', displayName: null, avatarUrl: null } });
    expect(buildPostNarration(post, now)).toMatch(/^alice, 2 hours ago\./);
  });

  it('says who reposted', () => {
    expect(buildPostNarration(makePost({ repostedBy: 'Bob' }), now)).toBe('Reposted by Bob. Alice Chen, 2 hours ago. Hello world.');
  });

  it('reads the alt text of a single image', () => {
    const post = makePost({ media: [{ kind: 'images', images: [{ url: 'u', alt: 'A dog on a beach' }] }] });
    expect(buildPostNarration(post, now)).toBe('Alice Chen, 2 hours ago. Hello world. One image: A dog on a beach.');
  });

  it('says plainly when an image has no description yet', () => {
    const post = makePost({ media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });
    expect(buildPostNarration(post, now)).toBe('Alice Chen, 2 hours ago. Hello world. One image, with no description yet.');
  });

  it('uses a cached description when the image has no alt text, and prefers alt text when it has', () => {
    const bare = makePost({ media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });
    const described = makePost({ media: [{ kind: 'images', images: [{ url: 'u', alt: 'Author alt' }] }] });
    expect(buildPostNarration(bare, now, 'A red bicycle')).toContain('One image: A red bicycle.');
    expect(buildPostNarration(described, now, 'A red bicycle')).toContain('One image: Author alt.');
  });

  it('counts several images and reads each one', () => {
    const post = makePost({
      media: [{ kind: 'images', images: [{ url: 'a', alt: 'A cat' }, { url: 'b', alt: null }, { url: 'c', alt: 'A tree.' }] }],
    });
    expect(buildPostNarration(post, now)).toBe(
      'Alice Chen, 2 hours ago. Hello world. 3 images. First image: A cat. Second image has no description yet. Third image: A tree.',
    );
  });

  it('describes video, links and quoted posts', () => {
    expect(buildPostNarration(makePost({ media: [{ kind: 'video', alt: null, thumbUrl: null }] }), now)).toContain('A video, with no description yet.');
    expect(buildPostNarration(makePost({ media: [{ kind: 'video', alt: 'Waves', thumbUrl: null }] }), now)).toContain('A video: Waves.');
    expect(buildPostNarration(makePost({ media: [{ kind: 'link', url: 'https://www.nasa.gov/moon', title: 'Moon news' }] }), now)).toContain(
      'Link to Moon news, from nasa.gov.',
    );
    expect(buildPostNarration(makePost({ media: [{ kind: 'link', url: 'https://nasa.gov/moon', title: '' }] }), now)).toContain('Link to nasa.gov.');
    expect(buildPostNarration(makePost({ media: [{ kind: 'quote', authorName: 'Bob', text: 'Big day' }] }), now)).toContain('Quoting Bob: Big day.');
  });

  it('handles a post with media and no text, and a post with nothing at all', () => {
    const imageOnly = makePost({ text: '', media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });
    expect(buildPostNarration(imageOnly, now)).toBe('Alice Chen, 2 hours ago. One image, with no description yet.');
    expect(buildPostNarration(makePost({ text: '  ' }), now)).toBe('Alice Chen, 2 hours ago. This post has no text.');
  });
});

describe('introInstructions', () => {
  it('tells screen reader users to double tap and everyone else to tap anywhere', () => {
    expect(introInstructions(true)).toMatch(/Double tap to continue\.$/);
    expect(introInstructions(true)).not.toMatch(/tap anywhere/i);
    expect(introInstructions(false)).toMatch(/Tap anywhere to continue\.$/);
    expect(introInstructions(false)).toContain('Draw a circle clockwise');
  });
});
