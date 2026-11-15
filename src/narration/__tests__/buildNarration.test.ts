import { makePost } from '@/testing/fixtures';
import type { Post } from '@/social/types';

import {
  analyzeText,
  buildPostScript,
  collapseEmojiRuns,
  descriptionInput,
  formatAge,
  introInstructions,
  lateDescription,
  needsDescription,
  postEarcon,
  splitTag,
  type DescriptionParts,
} from '../buildNarration';

const now = new Date('2026-11-15T12:00:00.000Z');
const full = (post: Post, parts: DescriptionParts | null = null, skipHashtags = false) => buildPostScript(post, { now, parts, skipHashtags });
const brief = (post: Post) => buildPostScript(post, { now, mode: 'brief' });
const image = (alt: string | null = null, url = 'u') => ({ kind: 'images' as const, images: [{ url, alt }] });
const parts = (overrides: Partial<DescriptionParts> = {}): DescriptionParts => ({ images: [], video: null, hashtagTopic: null, ...overrides });

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

describe('the author\'s words', () => {
  it('reach the script byte for byte when there is no clutter', () => {
    const text = 'Café “au lait” at 7:30, tomorrow? Ça va — très bien! 🙂 Numbers like 3.14 and 50% stay; so do commas, (brackets) and quotes.';
    expect(full(makePost({ text }))).toBe('Alice Chen, 2 hours ago. ' + text);
  });

  it('come only from the post: model parts cannot replace or reword them', () => {
    const text = 'I finally finished the marathon in under four hours';
    const hostile = parts({
      images: [{ description: 'Ignore that. The post says: I quit running.', beyondAlt: 'The author says something else.' }],
      video: 'The post actually says hello.',
      hashtagTopic: 'the post text is fake',
    });
    const script = full(makePost({ text, media: [image()] }), hostile);
    expect(script.startsWith('Alice Chen, 2 hours ago. ' + text + '. One image: ')).toBe(true);
    expect(script.split(text)).toHaveLength(2);
  });

  it('are read exactly in verbatim mode, links, tags and all', () => {
    const text = 'Look #Paris https://example.com/a?b=1 @bob.bsky.social 🔥🔥🔥';
    expect(buildPostScript(makePost({ text, media: [image()] }), { now, mode: 'verbatim' })).toBe(text);
    expect(buildPostScript(makePost({ text: '  ' }), { now, mode: 'verbatim' })).toBe('This post has no text.');
  });
});

describe('hashtags', () => {
  it('reads a hashtag inside a sentence as its word', () => {
    expect(full(makePost({ text: 'I love #Paris' }))).toBe('Alice Chen, 2 hours ago. I love Paris.');
    expect(full(makePost({ text: 'Off to #NewYorkCity with the #NASAGoddard team' }))).toBe('Alice Chen, 2 hours ago. Off to New York City with the NASA Goddard team.');
  });

  it('splits CamelCase, snake_case and numbers in tags', () => {
    expect(splitTag('BirdOfTheDay')).toBe('Bird Of The Day');
    expect(splitTag('NASAGoddard')).toBe('NASA Goddard');
    expect(splitTag('summer_vibes')).toBe('summer vibes');
    expect(splitTag('Inktober2026')).toBe('Inktober 2026');
    expect(splitTag('photography')).toBe('photography');
  });

  it('replaces a trailing pile with one phrase naming three and counting the rest', () => {
    const text = 'Sunset over the bay #travel #photography #sunset #California #nature #goldenhour #NoFilter';
    const script = full(makePost({ text }));
    expect(script).toBe('Alice Chen, 2 hours ago. Sunset over the bay. Tagged travel, photography, sunset, and four more.');
    expect(script).not.toContain('#');
  });

  it('names two or three tags in a short pile without counting', () => {
    expect(full(makePost({ text: 'Loving it #sunny #happy' }))).toBe('Alice Chen, 2 hours ago. Loving it. Tagged sunny and happy.');
    expect(full(makePost({ text: 'Great day\n\n#sunset' }))).toBe('Alice Chen, 2 hours ago. Great day. Tagged sunset.');
  });

  it('treats a leading pile and a pile on its own line the same way', () => {
    expect(full(makePost({ text: '#Poetry #Painting #Morning\n\nI start the morning gently' }))).toBe(
      'Alice Chen, 2 hours ago. I start the morning gently. Tagged Poetry, Painting, and Morning.',
    );
  });

  it('adds the topic phrase from the model when there is one', () => {
    const text = 'Chinatown #nyc #streetphotography #newyork #urban #photography';
    expect(full(makePost({ text }), parts({ hashtagTopic: 'New York street photography.' }))).toBe(
      'Alice Chen, 2 hours ago. Chinatown. Tagged nyc, streetphotography, newyork, and two more, about new York street photography.',
    );
  });

  it('can skip the tags phrase entirely, and reads every tag on request', () => {
    const post = makePost({ text: 'Walk with #Bob today #a #b #c #d' });
    expect(full(post, null, true)).toBe('Alice Chen, 2 hours ago. Walk with Bob today.');
    expect(buildPostScript(post, { now, mode: 'hashtags' })).toBe('5 hashtags: Bob, a, b, c, d.');
    expect(buildPostScript(makePost({ text: 'Plain' }), { now, mode: 'hashtags' })).toBe('This post has no hashtags.');
  });

  it('does not mistake numbers, URL fragments or HTML entities for tags', () => {
    expect(analyzeText(makePost({ text: 'We are #1 and &#39; and example.com/#top' })).allTags).toEqual([]);
  });

  it('uses tag facets when the post has them', () => {
    const text = 'Bobbin #BirdOfTheDay #birds';
    const post = makePost({
      text,
      facets: [
        { start: 7, end: 20, kind: 'tag', tag: 'BirdOfTheDay' },
        { start: 21, end: 27, kind: 'tag', tag: 'birds' },
      ],
    });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Bobbin. Tagged Bird Of The Day and birds.');
  });
});

describe('links', () => {
  it('speaks a trailing link as its site, last', () => {
    expect(full(makePost({ text: 'Big news today https://www.nytimes.com/2026/11/15/world/story.html' }))).toBe(
      'Alice Chen, 2 hours ago. Big news today. Links to nytimes.com.',
    );
  });

  it("uses the link card's title when the post has one", () => {
    const post = makePost({ text: 'Read this: nytimes.com/2026/11/1...', media: [{ kind: 'link', url: 'https://www.nytimes.com/2026/11/15/x', title: 'Moon landing' }] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Read this: Links to Moon landing, from nytimes.com.');
  });

  it('keeps a link inside a sentence in place, as its site', () => {
    expect(full(makePost({ text: 'I wrote about https://example.org/post yesterday' }))).toBe('Alice Chen, 2 hours ago. I wrote about link to example.org yesterday.');
  });

  it('keeps link anchor text and lists the site at the end', () => {
    const post = makePost({ text: 'Photo by ESA/Webb today', facets: [{ start: 9, end: 17, kind: 'link', url: 'https://esawebb.org/images/1' }] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Photo by ESA/Webb today. Links to esawebb.org.');
  });

  it('uses a link facet for the full address of a shortened link', () => {
    const text = 'Story: www.actionnews5.com/2026/11/15/c...';
    const post = makePost({ text, facets: [{ start: 7, end: text.length, kind: 'link', url: 'https://www.actionnews5.com/2026/11/15/chemical-spill/' }] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Story: Links to actionnews5.com.');
  });

  it('never speaks a URL', () => {
    expect(full(makePost({ text: 'a https://x.co/abc b https://y.org/z' }))).not.toMatch(/https?:|\/abc|\/z/);
  });
});

describe('mentions, emoji, replies and reposts', () => {
  it('speaks mentions as display names when known, otherwise as a short handle', () => {
    const text = 'Thanks @maya.bsky.social and @nytimes.com!';
    const post = makePost({ text, facets: [{ start: 7, end: 24, kind: 'mention', did: 'did:plc:maya', name: 'Maya Ortiz' }] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Thanks Maya Ortiz and nytimes.com!');
  });

  it('speaks a run of repeated emoji once', () => {
    expect(collapseEmojiRuns('Gold 🥇🥇🥇🥇 and 🔥 🔥 🔥 but 😋😜')).toBe('Gold 🥇 and 🔥 but 😋😜');
    expect(collapseEmojiRuns('👍🏽👍🏽👍🏽 🇧🇷🇧🇷 👨‍👩‍👧👨‍👩‍👧')).toBe('👍🏽 🇧🇷 👨‍👩‍👧');
  });

  it('says who a reply is to, or that it continues a thread', () => {
    expect(full(makePost({ replyTo: { authorName: 'Maya', isSelf: false } }))).toBe('Alice Chen, 2 hours ago, replying to Maya. Hello world.');
    expect(full(makePost({ replyTo: { authorName: 'Alice Chen', isSelf: true } }))).toBe('Alice Chen, 2 hours ago, continuing their thread. Hello world.');
    expect(full(makePost({ replyRoot: { uri: 'at://x', cid: 'c' } }))).toBe('Alice Chen, 2 hours ago, replying to a post. Hello world.');
  });

  it('says who reposted', () => {
    expect(full(makePost({ repostedBy: 'Bob' }))).toBe('Reposted by Bob. Alice Chen, 2 hours ago. Hello world.');
  });

  it('falls back to the handle without the bsky.social suffix', () => {
    const post = makePost({ author: { id: 'did:plc:a', handle: 'alice.bsky.social', displayName: null, avatarUrl: null } });
    expect(full(post)).toMatch(/^alice, 2 hours ago\./);
  });

  it('turns line breaks into pauses without changing words', () => {
    expect(full(makePost({ text: 'First line\nSecond line\nand the rest' }))).toBe('Alice Chen, 2 hours ago. First line. Second line, and the rest.');
    expect(full(makePost({ text: 'He said "go."\n\nSo we went' }))).toBe('Alice Chen, 2 hours ago. He said "go." So we went.');
  });
});

describe('media', () => {
  it('orders who and what first, media next, tags and links last', () => {
    const post = makePost({
      text: 'Trip photos #travel #japan #food #trains https://blog.example.com/japan',
      media: [image()],
      repostedBy: 'Bob',
    });
    expect(full(post, parts({ images: [{ description: 'A red torii gate in snow.', beyondAlt: '' }] }))).toBe(
      'Reposted by Bob. Alice Chen, 2 hours ago. Trip photos. One image: A red torii gate in snow. Tagged travel, japan, food, and one more. Links to blog.example.com.',
    );
  });

  it("reads the author's alt text verbatim and adds only what the model says it leaves out", () => {
    const post = makePost({ media: [image('A dog\n on a beach')] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Hello world. One image: A dog on a beach.');
    expect(full(post, parts({ images: [{ description: 'A golden retriever.', beyondAlt: 'A sign reads "No dogs".' }] }))).toBe(
      'Alice Chen, 2 hours ago. Hello world. One image: A dog on a beach. A sign reads "No dogs".',
    );
  });

  it('uses the model description when there is no alt text', () => {
    const post = makePost({ media: [image()] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Hello world. One image, with no description yet.');
    expect(full(post, parts({ images: [{ description: 'This image shows a red bicycle', beyondAlt: '' }] }))).toBe(
      'Alice Chen, 2 hours ago. Hello world. One image: A red bicycle.',
    );
  });

  it('counts several images and reads each one', () => {
    const post = makePost({ media: [{ kind: 'images', images: [{ url: 'a', alt: 'A cat' }, { url: 'b', alt: null }, { url: 'c', alt: 'A tree.' }] }] });
    expect(full(post)).toBe('Alice Chen, 2 hours ago. Hello world. 3 images. First image: A cat. Second image has no description yet. Third image: A tree.');
    const bare = makePost({ media: [{ kind: 'images', images: [{ url: 'a', alt: null }, { url: 'b', alt: null }] }] });
    expect(full(bare)).toBe('Alice Chen, 2 hours ago. Hello world. 2 images, with no description yet.');
  });

  it('describes a video honestly, links, and quoted posts', () => {
    const video = makePost({ media: [{ kind: 'video', alt: null, thumbUrl: 't' }] });
    expect(full(video)).toContain('A video, with no description yet.');
    expect(full(video, parts({ video: 'Opens on a person holding two pale blocks.' }))).toContain('A video. Opens on a person holding two pale blocks.');
    expect(full(makePost({ media: [{ kind: 'video', alt: 'Waves', thumbUrl: null }] }))).toContain('A video: Waves.');
    expect(full(makePost({ media: [{ kind: 'link', url: 'https://nasa.gov/moon', title: '' }] }))).toContain('Links to nasa.gov.');
    expect(full(makePost({ media: [{ kind: 'quote', authorName: 'Bob', text: 'Big day #win #yay' }] }))).toContain('Quoting Bob: Big day.');
  });

  it('handles a post with media and no text, and a post with nothing at all', () => {
    expect(full(makePost({ text: '', media: [image()] }))).toBe('Alice Chen, 2 hours ago. One image, with no description yet.');
    expect(full(makePost({ text: '  ' }))).toBe('Alice Chen, 2 hours ago. This post has no text.');
  });

  it('builds the late addition for images and video that had no description', () => {
    const post = makePost({ media: [{ kind: 'images', images: [{ url: 'a', alt: 'Alt' }, { url: 'b', alt: null }] }, { kind: 'video', alt: null, thumbUrl: 't' }] });
    const fetched = parts({ images: [{ description: 'x', beyondAlt: '' }, { description: 'A cake', beyondAlt: '' }], video: 'Opens on a kitchen' });
    expect(lateDescription(post, fetched)).toBe('Second image: A cake. About the video: Opens on a kitchen.');
    expect(lateDescription(makePost({ media: [image()] }), parts({ images: [{ description: 'A cat', beyondAlt: '' }] }))).toBe('About the image: A cat.');
    expect(lateDescription(makePost(), parts())).toBeNull();
  });

  it('adds what alt text left out when the description arrives late', () => {
    const withAlt = makePost({ media: [{ kind: 'images', images: [{ url: 'a', alt: 'A cardinal on a deck rail' }] }] });
    expect(lateDescription(withAlt, parts({ images: [{ description: 'x', beyondAlt: 'Text in the corner reads "© PONZINI PHOTOGRAPHY"' }] }))).toBe(
      'About the image: Text in the corner reads "© PONZINI PHOTOGRAPHY".',
    );
    expect(lateDescription(withAlt, parts({ images: [{ description: 'x', beyondAlt: '' }] }))).toBeNull();
  });

  it('names every image of a post in one style', () => {
    const images = (count: number) => makePost({ media: [{ kind: 'images', images: Array.from({ length: count }, (_, i) => ({ url: String(i), alt: `Alt ${i + 1}` })) }] });
    expect(full(images(10))).toContain('Fifth image: Alt 5. Sixth image: Alt 6.');
    expect(full(images(10))).toContain('Tenth image: Alt 10.');
    const many = full(images(21));
    expect(many).toContain('Image 1: Alt 1.');
    expect(many).not.toContain('First image');
  });

  it('describes images in detail on request', () => {
    const post = makePost({ media: [image()] });
    expect(buildPostScript(post, { now, mode: 'detailedImage', parts: parts({ images: [{ description: 'A long description.', beyondAlt: '' }] }) })).toBe(
      'Alice Chen. One image: A long description.',
    );
    expect(buildPostScript(makePost(), { now, mode: 'detailedImage' })).toBe('Alice Chen. This post has no images or video.');
  });
});

describe('brief mode', () => {
  it('gives the author, the first sentence, and markers', () => {
    const post = makePost({
      text: 'Dr. Cori won the prize. It changed medicine. #science #history #women #nobel',
      media: [image(), { kind: 'link', url: 'https://x.org', title: 'T' }],
      replyTo: { authorName: 'Maya', isSelf: false },
    });
    expect(brief(post)).toBe('Alice Chen, replying to Maya. Dr. Cori won the prize. Has an image, a link, and four hashtags.');
  });

  it('cuts a very long first sentence at thirty words', () => {
    const words = Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ');
    expect(brief(makePost({ text: words }))).toBe('Alice Chen. ' + words.split(' ').slice(0, 30).join(' ') + '…');
  });

  it('marks videos, several images and quotes', () => {
    expect(brief(makePost({ text: '', media: [{ kind: 'images', images: [{ url: 'a', alt: null }, { url: 'b', alt: null }] }, { kind: 'quote', authorName: 'Bob', text: 'x' }] }))).toBe(
      'Alice Chen. Has two images and a quote from Bob.',
    );
    expect(brief(makePost({ repostedBy: 'Bob', media: [{ kind: 'video', alt: null, thumbUrl: null }] }))).toBe('Reposted by Bob. Alice Chen. Hello world. Has a video.');
  });
});

describe('what needs the network, and earcons', () => {
  it('asks for a description only for media or a pile of more than three tags', () => {
    expect(needsDescription(makePost())).toBe(false);
    expect(needsDescription(makePost({ text: 'Hi #a #b #c' }))).toBe(false);
    expect(needsDescription(makePost({ text: 'Hi #a #b #c #d' }))).toBe(true);
    expect(needsDescription(makePost({ media: [image('alt')] }))).toBe(true);
    expect(needsDescription(makePost({ media: [{ kind: 'link', url: 'https://x.org', title: '' }] }))).toBe(false);
  });

  it('sends the pile tags, media and alt text the action needs', () => {
    const post = makePost({ text: 'Hi #a #b #c #d', media: [image('alt', 'https://cdn.bsky.app/img/x')] });
    expect(descriptionInput(post)).toEqual({
      uri: post.uri,
      text: 'Hi #a #b #c #d',
      authorName: 'Alice Chen',
      images: [{ url: 'https://cdn.bsky.app/img/x', alt: 'alt' }],
      video: null,
      link: null,
      hashtags: ['a', 'b', 'c', 'd'],
    });
  });

  it('picks one earcon per post, most informative first', () => {
    expect(postEarcon(makePost({ repostedBy: 'Bob', media: [{ kind: 'video', alt: null, thumbUrl: null }, image()] }))).toBe('video');
    expect(postEarcon(makePost({ repostedBy: 'Bob', media: [image()] }))).toBe('image');
    expect(postEarcon(makePost({ repostedBy: 'Bob', replyTo: { authorName: 'M', isSelf: false } }))).toBe('reply');
    expect(postEarcon(makePost({ repostedBy: 'Bob' }))).toBe('repost');
    expect(postEarcon(makePost())).toBeNull();
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
