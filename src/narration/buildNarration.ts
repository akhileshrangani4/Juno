import type { Post, PostMedia } from '@/social/types';

const ORDINALS = ['First', 'Second', 'Third', 'Fourth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;

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

const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0];

export function speakableText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, (url) => `link to ${hostOf(url)}`)
    .replace(/\s+/g, ' ')
    .trim();
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

function describeMedia(media: PostMedia, description: string | null): string {
  switch (media.kind) {
    case 'images': {
      const { images } = media;
      if (images.length === 1) {
        const alt = images[0].alt ?? description;
        return alt ? `One image: ${sentence(alt)}` : 'One image, with no description yet.';
      }
      const parts = images.map((image, i) => {
        const name = `${ORDINALS[i] ?? `Image ${i + 1}`}${ORDINALS[i] ? ' image' : ''}`;
        return image.alt ? `${name}: ${sentence(image.alt)}` : `${name} has no description yet.`;
      });
      return [`${images.length} images.`, ...parts].join(' ');
    }
    case 'video': {
      const alt = media.alt ?? description;
      return alt ? `A video: ${sentence(alt)}` : 'A video, with no description yet.';
    }
    case 'link':
      return media.title ? `Link to ${sentence(`${media.title}, from ${hostOf(media.url)}`)}` : `Link to ${hostOf(media.url)}.`;
    case 'quote':
      return media.text ? `Quoting ${media.authorName}: ${sentence(speakableText(media.text))}` : `Quoting a post by ${media.authorName}.`;
  }
}

export function authorName(post: Post): string {
  return post.author.displayName ?? post.author.handle.replace(/\.bsky\.social$/, '');
}

export function buildPostNarration(post: Post, now: Date, description: string | null = null): string {
  const text = speakableText(post.text);
  return [
    post.repostedBy ? `Reposted by ${post.repostedBy}.` : null,
    `${authorName(post)}, ${formatAge(post.createdAt, now)}.`,
    text ? sentence(text) : null,
    ...post.media.map((media) => describeMedia(media, description)),
    !text && post.media.length === 0 ? 'This post has no text.' : null,
  ]
    .filter(Boolean)
    .join(' ');
}

const GESTURES =
  'Tap the bottom half of the screen for the next post. Tap the top half for the previous post. Draw a circle clockwise anywhere on the screen to wake the voice agent. Draw a circle counter-clockwise to put it to sleep and go back to scrolling.';

export const messages = {
  intro: `Welcome. This app reads your social feed aloud, one post at a time. ${GESTURES} Tap anywhere to continue.`,
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
  feedError: 'Could not load posts. Tap the bottom half of the screen to try again.',
};
