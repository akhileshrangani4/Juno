import type { FeedName } from '@/social/types';

export const feedNames: Record<FeedName, string> = { forYou: 'For You', following: 'Following' };

export const otherFeed = (feed: FeedName): FeedName => (feed === 'forYou' ? 'following' : 'forYou');

export const feedMessages = {
  switched: (feed: FeedName) => `${feedNames[feed]}.`,
  // What a refresh found: null when it couldn't reach Bluesky.
  refreshed: (count: number | null) =>
    count === null ? "Couldn't refresh. Check the connection and try again." : count === 0 ? 'Nothing new.' : `${count} new ${count === 1 ? 'post' : 'posts'}.`,
  more: 'More like this.',
  less: 'Less like this.',
};
