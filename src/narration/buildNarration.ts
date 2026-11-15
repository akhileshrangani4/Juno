import { APP_NAME } from '../appName';
import type { Post, PostImage, PostMedia } from '../social/types';

export type NarrationMode = 'full' | 'brief' | 'verbatim' | 'hashtags' | 'detailedImage';
export type DetailLevel = 'standard' | 'detailed';
export type EarconKind = 'image' | 'video' | 'repost' | 'reply';

export type ImageDescription = { description: string; beyondAlt: string };
export type DescriptionParts = { images: ImageDescription[]; video: string | null; hashtagTopic: string | null };

export type DescriptionInput = {
  uri: string;
  text: string;
  authorName: string;
  images: { url: string; alt: string | null }[];
  video: { thumbUrl: string | null; alt: string | null; captions: { lang: string; cid: string }[]; aspectRatio: { width: number; height: number } | null } | null;
  link: { url: string; title: string } | null;
  hashtags: string[];
};

// A reply read inside a post's comments: its place in the thread and whose reply it answers (null for a direct reply to the post).
export type ReplyPosition = { index: number; total: number; answering: string | null };

export type ScriptOptions = { now: Date; mode?: NarrationMode; parts?: DescriptionParts | null; skipHashtags?: boolean; reply?: ReplyPosition };

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TAGS_NAMED = 3;
const TOPIC_THRESHOLD = 3;
const BRIEF_MAX_WORDS = 30;
const MODEL_TEXT_MAX = 1500;

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;
const numberWord = (count: number) => NUMBER_WORDS[count] ?? String(count);

export function formatAge(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  const seconds = (now.getTime() - created.getTime()) / 1000;
  if (Number.isNaN(seconds)) return 'some time ago';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return plural(Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return plural(Math.floor(seconds / 3600), 'hour');
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return plural(days, 'day');
  const date = `on ${MONTHS[created.getUTCMonth()]} ${created.getUTCDate()}`;
  return created.getUTCFullYear() === now.getUTCFullYear() ? date : `${date}, ${created.getUTCFullYear()}`;
}

export const hostOf = (url: string) =>
  url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#…]/)[0]
    .toLowerCase();

const sentence = (text: string) => (/[.!?…:]["'”’»)\]]*$/u.test(text) ? text : `${text}.`);

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function splitTag(tag: string): string {
  return tag
    .replace(/_+/g, ' ')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .trim();
}

const handleName = (handle: string) => handle.replace(/^@/, '').replace(/\.bsky\.social$/i, '');

const EMOJI = '(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*)*)';
const REPEATED_EMOJI = new RegExp(`(${EMOJI})(?:\\s*\\1)+`, 'gu');

export function collapseEmojiRuns(text: string): string {
  return text.replace(REPEATED_EMOJI, '$1');
}

type Span = { start: number; end: number } & ({ kind: 'link'; url: string } | { kind: 'anchor'; url: string } | { kind: 'mention'; handle: string; name: string | null } | { kind: 'tag'; tag: string });

const LOOKS_LIKE_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#…]|$)/i;
const INVISIBLE = /[\u200B\u2060\uFEFF\uFFFC]/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+|\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*/gi;
const MENTION_PATTERN = /(^|[^\w@/.])(@[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi;
const TAG_PATTERN = /(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;

function findSpans(post: Post): Span[] {
  const { text } = post;
  const spans: Span[] = (post.facets ?? []).flatMap((facet): Span[] => {
    switch (facet.kind) {
      case 'link':
        return [{ start: facet.start, end: facet.end, kind: LOOKS_LIKE_URL.test(text.slice(facet.start, facet.end).trim()) ? 'link' : 'anchor', url: facet.url }];
      case 'mention':
        return [{ start: facet.start, end: facet.end, kind: 'mention', handle: text.slice(facet.start, facet.end), name: facet.name }];
      case 'tag':
        return [{ start: facet.start, end: facet.end, kind: 'tag', tag: facet.tag }];
    }
  });
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = /(\.\.\.|…)$/.test(match[0]) ? match[0] : match[0].replace(/[),.!?;:'"]+$/, '');
    spans.push({ start: match.index, end: match.index + url.length, kind: 'link', url });
  }
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index + match[1].length;
    const handle = match[2].replace(/\.$/, '');
    spans.push({ start, end: start + handle.length, kind: 'mention', handle, name: null });
  }
  for (const match of text.matchAll(TAG_PATTERN)) {
    const start = match.index + match[1].length;
    spans.push({ start, end: start + match[2].length + 1, kind: 'tag', tag: match[2] });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const span of spans) if (!kept.length || span.start >= kept[kept.length - 1].end) kept.push(span);
  return kept;
}

export type TextAnalysis = {
  body: string;
  pileTags: string[];
  allTags: string[];
  trailingLinks: string[];
  anchorLinks: string[];
};

const isBlank = (text: string) => /^[\s.,;:!?…·|•\-–—]*$/u.test(text);
const uniqueTags = (tags: string[]) => tags.filter((tag, i) => tags.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === i);

export function analyzeText(post: Post): TextAnalysis {
  const { text } = post;
  const spans = findSpans(post);
  const removed = new Set<Span>();
  const pileTags: string[] = [];
  const masked = spans.reduce((masking, span) => (span.kind === 'link' ? masking.slice(0, span.start) + ' '.repeat(span.end - span.start) + masking.slice(span.end) : masking), text);

  for (let i = 0; i < spans.length; ) {
    if (spans[i].kind !== 'tag') {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < spans.length && spans[j + 1].kind === 'tag' && /^\s*$/.test(text.slice(spans[j].end, spans[j + 1].start))) j += 1;
    const before = masked.slice(0, spans[i].start);
    const after = masked.slice(spans[j].end);
    const ownLine = /(^|\n)[ \t]*$/.test(before) && /^[ \t]*(\n|$)/.test(after);
    if (ownLine || (j > i && (isBlank(before) || isBlank(after)))) {
      for (let k = i; k <= j; k += 1) {
        const span = spans[k];
        removed.add(span);
        if (span.kind === 'tag') pileTags.push(span.tag);
      }
    }
    i = j + 1;
  }

  const trailingLinks: string[] = [];
  let tail = text.length;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const span = spans[i];
    if (removed.has(span)) {
      tail = span.start;
      continue;
    }
    if (span.kind !== 'link' || !isBlank(text.slice(span.end, tail))) break;
    removed.add(span);
    trailingLinks.unshift(span.url);
    tail = span.start;
  }

  let body = '';
  let cursor = 0;
  for (const span of spans) {
    body += text.slice(cursor, span.start);
    cursor = span.end;
    if (removed.has(span)) continue;
    if (span.kind === 'link') body += `link to ${hostOf(span.url)}`;
    else if (span.kind === 'anchor') body += text.slice(span.start, span.end);
    else if (span.kind === 'mention') body += span.name ?? handleName(span.handle);
    else body += splitTag(span.tag);
  }
  body += text.slice(cursor);

  body = collapseEmojiRuns(body.replace(INVISIBLE, ''))
    .replace(/[ \t]*\n\s*/g, (match: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset).trimEnd();
      const next = whole.slice(offset + match.length);
      if (!before || /[.!?…:;,]["'”’»)\]]*$/u.test(before)) return ' ';
      return /^\p{Ll}/u.test(next) ? ', ' : '. ';
    })
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/^[\s.,;:·|•\-–—]+/u, '')
    .replace(/[\s,;·|•\-–—]+$/u, '')
    .trim();

  return {
    body,
    pileTags: uniqueTags(pileTags),
    allTags: uniqueTags(spans.flatMap((span) => (span.kind === 'tag' ? [span.tag] : []))),
    trailingLinks,
    anchorLinks: spans.flatMap((span) => (span.kind === 'anchor' ? [span.url] : [])),
  };
}

export function authorName(post: Post): string {
  return post.author.displayName?.trim() || handleName(post.author.handle);
}

function replyHeader(post: Post, { index, total, answering }: ReplyPosition): string {
  return sentence([`Reply ${index + 1} of ${total}, from ${authorName(post)}`, answering ? `replying to ${answering}` : null].filter(Boolean).join(', '));
}

export function replyCount(count: number): string | null {
  return count > 0 ? `${count} ${count === 1 ? 'reply' : 'replies'}.` : null;
}

function header(post: Post, now: Date | null, position?: ReplyPosition): string {
  if (position) return replyHeader(post, position);
  const reply = post.replyTo
    ? post.replyTo.isSelf
      ? 'continuing their thread'
      : post.replyTo.authorName
        ? `replying to ${post.replyTo.authorName}`
        : 'replying to a post'
    : post.replyRoot
      ? 'replying to a post'
      : null;
  return sentence([authorName(post), now ? formatAge(post.createdAt, now) : null, reply].filter(Boolean).join(', '));
}

export function cleanModelText(text: string | null | undefined): string {
  if (!text) return '';
  const flat = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(this|the) (image|photo|picture|video|screenshot) (shows|depicts|features|is of)\s*/i, '');
  const capped = flat.length > MODEL_TEXT_MAX ? flat.slice(0, flat.lastIndexOf(' ', MODEL_TEXT_MAX)) : flat;
  return capped ? capped[0].toUpperCase() + capped.slice(1) : '';
}

const flatten = (text: string) => text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

function imageText(image: PostImage, part: ImageDescription | undefined): string | null {
  const extra = cleanModelText(part?.beyondAlt);
  const alt = image.alt ? flatten(image.alt) : '';
  if (alt) return extra ? `${sentence(alt)} ${sentence(extra)}` : sentence(alt);
  const description = cleanModelText(part?.description);
  return description ? sentence(description) : null;
}

// One naming style per post: ordinals while they last, numbers for every image of a larger set.
const imageName = (i: number, count: number) => (count <= ORDINALS.length ? `${ORDINALS[i]} image` : `Image ${i + 1}`);
// Alt text was already spoken with the post, so a late description adds only what the alt text left out.
function beyondAltText(part: ImageDescription | undefined): string | null {
  const extra = cleanModelText(part?.beyondAlt);
  return extra ? sentence(extra) : null;
}

const allImages = (post: Post) => post.media.flatMap((media) => (media.kind === 'images' ? media.images : []));

const quotedPost = (text: string): Post => ({
  uri: '',
  cid: '',
  author: { id: '', handle: '', displayName: null, avatarUrl: null },
  text,
  createdAt: '',
  media: [],
  repostedBy: null,
  replyRoot: null,
  counts: { likes: 0, reposts: 0, replies: 0 },
  likeUri: null,
});

function describeMedia(media: PostMedia, parts: DescriptionParts | null, imageOffset: number): string | null {
  switch (media.kind) {
    case 'images': {
      const texts = media.images.map((image, i) => imageText(image, parts?.images[imageOffset + i]));
      if (texts.length === 1) return texts[0] ? `One image: ${texts[0]}` : 'One image, with no description yet.';
      if (texts.every((text) => !text)) return `${texts.length} images, with no description yet.`;
      const named = texts.map((text, i) => (text ? `${imageName(i, texts.length)}: ${text}` : `${imageName(i, texts.length)} has no description yet.`));
      return [`${texts.length} images.`, ...named].join(' ');
    }
    case 'video': {
      const described = cleanModelText(parts?.video);
      const alt = media.alt ? flatten(media.alt) : '';
      if (alt) return described ? `A video: ${sentence(alt)} ${sentence(described)}` : `A video: ${sentence(alt)}`;
      return described ? `A video. ${sentence(described)}` : 'A video, with no description yet.';
    }
    case 'quote': {
      const quoted = media.text ? analyzeText(quotedPost(media.text)).body : '';
      return quoted ? `Quoting ${media.authorName}: ${sentence(quoted)}` : `Quoting a post by ${media.authorName}.`;
    }
    case 'link':
      return null;
  }
}

function mediaSentences(post: Post, parts: DescriptionParts | null, includeQuotes: boolean): string[] {
  let offset = 0;
  const visual = post.media.filter((media) => media.kind === 'images' || media.kind === 'video');
  const quotes = includeQuotes ? post.media.filter((media) => media.kind === 'quote') : [];
  return [...visual, ...quotes].flatMap((media) => {
    const text = describeMedia(media, parts, offset);
    if (media.kind === 'images') offset += media.images.length;
    return text ? [text] : [];
  });
}

export function tagList(tags: string[]): string {
  const named = tags.slice(0, TAGS_NAMED).map(splitTag);
  const more = tags.length - named.length;
  return more ? `${named.join(', ')}, and ${numberWord(more)} more` : listOf(named);
}

function tagSentence(tags: string[], topic: string | null): string | null {
  if (!tags.length) return null;
  const list = tagList(tags);
  const about = cleanModelText(topic).replace(/[.!?]+$/, '');
  return sentence(`Tagged ${list}${about ? `, about ${about[0].toLowerCase()}${about.slice(1)}` : ''}`);
}

function linkSentence(post: Post, links: string[]): string | null {
  const entries: { host: string; title: string | null }[] = [];
  const add = (url: string, title: string | null) => {
    const host = hostOf(url);
    const existing = entries.find((entry) => entry.host === host);
    if (existing) existing.title ??= title;
    else if (host) entries.push({ host, title });
  };
  post.media.forEach((media) => media.kind === 'link' && add(media.url, media.title.trim() || null));
  links.forEach((url) => add(url, null));
  if (!entries.length) return null;
  return sentence(`Links to ${listOf(entries.map(({ host, title }) => (title ? `${title}, from ${host}` : host)))}`);
}

export function needsDescription(post: Post): boolean {
  return post.media.some((media) => media.kind === 'images' || media.kind === 'video') || analyzeText(post).pileTags.length > TOPIC_THRESHOLD;
}

export function postEarcon(post: Post): EarconKind | null {
  if (post.media.some((media) => media.kind === 'video')) return 'video';
  if (post.media.some((media) => media.kind === 'images')) return 'image';
  if (post.replyTo || post.replyRoot) return 'reply';
  if (post.repostedBy) return 'repost';
  return null;
}

export function descriptionInput(post: Post): DescriptionInput {
  const video = post.media.find((media) => media.kind === 'video');
  const link = post.media.find((media) => media.kind === 'link');
  return {
    uri: post.uri,
    text: post.text,
    authorName: authorName(post),
    images: allImages(post).map(({ url, alt }) => ({ url, alt })),
    video: video ? { thumbUrl: video.thumbUrl, alt: video.alt, captions: video.captions ?? [], aspectRatio: video.aspectRatio ?? null } : null,
    link: link ? { url: link.url, title: link.title } : null,
    hashtags: analyzeText(post).pileTags,
  };
}

const ABBREVIATIONS = /(?:^|\s)(?:dr|mr|mrs|ms|st|jr|sr|vs|etc|no|prof|mt|ft|e\.g|i\.e)\.$/i;

function briefSentence(body: string): string {
  let first = body;
  for (const match of body.matchAll(/[.!?…]["'”’»)\]]*(?=\s|$)/gu)) {
    const candidate = body.slice(0, match.index + match[0].length);
    if (!ABBREVIATIONS.test(candidate)) {
      first = candidate;
      break;
    }
  }
  const words = first.split(' ');
  return words.length > BRIEF_MAX_WORDS ? `${words.slice(0, BRIEF_MAX_WORDS).join(' ')}…` : sentence(first);
}

function briefMarkers(post: Post, analysis: TextAnalysis, skipHashtags: boolean): string | null {
  const images = allImages(post).length;
  const tags = analysis.pileTags.length;
  const markers = [
    images ? (images === 1 ? 'an image' : `${numberWord(images)} images`) : null,
    post.media.some((media) => media.kind === 'video') ? 'a video' : null,
    ...post.media.flatMap((media) => (media.kind === 'quote' ? [`a quote from ${media.authorName}`] : [])),
    post.media.some((media) => media.kind === 'link') || analysis.trailingLinks.length || analysis.anchorLinks.length ? 'a link' : null,
    !skipHashtags && tags ? `${numberWord(tags)} hashtag${tags === 1 ? '' : 's'}` : null,
  ].filter((marker): marker is string => marker !== null);
  return markers.length ? sentence(`Has ${listOf(markers)}`) : null;
}

const join = (pieces: (string | null)[]) => pieces.filter(Boolean).join(' ');

export function buildPostScript(post: Post, { now, mode = 'full', parts = null, skipHashtags = false, reply }: ScriptOptions): string {
  if (mode === 'verbatim') return post.text.trim() || 'This post has no text.';
  const analysis = analyzeText(post);
  const repost = post.repostedBy ? `Reposted by ${post.repostedBy}.` : null;
  const replies = reply ? null : replyCount(post.counts.replies);
  switch (mode) {
    case 'hashtags': {
      const tags = analysis.allTags.map(splitTag);
      if (!tags.length) return 'This post has no hashtags.';
      return tags.length === 1 ? `One hashtag: ${tags[0]}.` : `${tags.length} hashtags: ${tags.join(', ')}.`;
    }
    case 'detailedImage': {
      const media = mediaSentences(post, parts, false);
      return join([header(post, null, reply), media.length ? media.join(' ') : 'This post has no images or video.']);
    }
    case 'brief':
      return join([repost, header(post, null, reply), analysis.body ? briefSentence(analysis.body) : null, briefMarkers(post, analysis, skipHashtags), replies]);
    case 'full': {
      const media = mediaSentences(post, parts, true);
      const tags = skipHashtags ? null : tagSentence(analysis.pileTags, parts?.hashtagTopic ?? null);
      const links = linkSentence(post, [...analysis.anchorLinks, ...analysis.trailingLinks]);
      const empty = !analysis.body && !media.length && !links && !analysis.pileTags.length;
      return join([repost, header(post, now, reply), analysis.body ? sentence(analysis.body) : null, ...media, tags, links, empty ? 'This post has no text.' : null, replies]);
    }
  }
}

export function lateDescription(post: Post, parts: DescriptionParts): string | null {
  let offset = 0;
  const pieces = post.media.flatMap((media) => {
    if (media.kind === 'images') {
      const start = offset;
      offset += media.images.length;
      const described = media.images.flatMap((image, i) => {
        const text = image.alt ? beyondAltText(parts.images[start + i]) : imageText(image, parts.images[start + i]);
        return text ? [media.images.length === 1 ? `About the image: ${text}` : `${imageName(i, media.images.length)}: ${text}`] : [];
      });
      return described;
    }
    if (media.kind === 'video' && !media.alt) {
      const described = cleanModelText(parts.video);
      return described ? [`About the video: ${sentence(described)}`] : [];
    }
    return [];
  });
  return pieces.length ? pieces.join(' ') : null;
}

const GESTURES =
  'Tap the bottom half of the screen for the next post. Tap the top half for the previous post. Swiping right or left does the same. Swipe up to hear the replies, and swipe down to come back. Hold two fingers on the screen to like a post. Draw a circle clockwise anywhere on the screen to wake the voice agent. Draw a circle counter-clockwise to put it to sleep and go back to scrolling.';

export const INTRO_SUMMARY = `Welcome to ${APP_NAME}. It reads your social feed aloud, one post at a time.`;

export function introInstructions(screenReader: boolean): string {
  return `${GESTURES} ${screenReader ? 'Double tap to continue.' : 'Tap anywhere to continue.'}`;
}

const times = (rate: number) => `${Number(rate.toFixed(2))} times normal`;

export const messages = {
  unrecognized: 'Gesture not recognized.',
  gestures: GESTURES,
  alreadyAwake: 'The agent is already awake.',
  alreadyScrolling: 'You are already scrolling.',
  loadingFirst: 'Loading posts.',
  agentAwake: 'Agent is awake. Draw a circle counter-clockwise to go back to scrolling.',
  agentAsleep: 'Agent is asleep. Back to scrolling.',
  atStart: 'This is the first post.',
  atEnd: 'You have reached the end of the feed.',
  loading: 'Loading more posts.',
  empty: 'There are no posts to read right now.',
  unavailable: 'No posts could be shown right now.',
  noMore: 'No more posts could be shown right now.',
  feedError: 'Could not load posts. Tap the bottom half of the screen to try again.',
  briefMode: 'Brief narration.',
  fullMode: 'Full narration.',
  earconsOn: 'Post sounds on.',
  earconsOff: 'Post sounds off.',
  rate: (rate: number) => `Speed ${times(rate)}.`,
  screenReaderRate: "Speech speed follows VoiceOver's speaking rate. Change it with the Speaking Rate setting in the VoiceOver rotor.",
  fastest: (rate: number) => `Already at the fastest speed, ${times(rate)}.`,
  slowest: (rate: number) => `Already at the slowest speed, ${times(rate)}.`,
};
