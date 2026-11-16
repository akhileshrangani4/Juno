import { feedNames, otherFeed } from '@/feed/feedMessages';
import type { FeedName } from '@/social/types';

export type Mode = 'scroll' | 'agent';

export type SurfaceView = 'feed' | 'comments' | 'agent';

export type SurfaceActionName = 'next' | 'previous' | 'like' | 'comments' | 'back' | 'reread' | 'readExactly' | 'toggleAgent' | 'instructions' | 'account' | 'camera' | 'switchFeed' | 'refresh' | 'increment' | 'decrement';

export type SurfaceAction = { name: SurfaceActionName; label?: string };

// feed: the feed showing, or null signed out, when there is no other feed to switch to.
export function surfaceActions(view: SurfaceView, platform: string, liked: boolean, feed: FeedName | null = null): SurfaceAction[] {
  const like: SurfaceAction = { name: 'like', label: liked ? 'Remove like' : 'Like' };
  const labeled: SurfaceAction[] =
    view === 'feed'
      ? [
          { name: 'next', label: 'Next post' },
          { name: 'previous', label: 'Previous post' },
          like,
          { name: 'comments', label: 'Open comments' },
          { name: 'reread', label: 'Read this post again' },
          { name: 'readExactly', label: 'Read exactly' },
          ...(feed ? [{ name: 'switchFeed' as const, label: `Switch to ${feedNames[otherFeed(feed)]}` }] : []),
          { name: 'refresh', label: 'Refresh' },
          { name: 'toggleAgent', label: 'Wake the agent' },
          { name: 'camera', label: 'Open the camera' },
        ]
      : view === 'comments'
        ? [
            { name: 'next', label: 'Next reply' },
            { name: 'previous', label: 'Previous reply' },
            like,
            { name: 'back', label: 'Back to posts' },
            { name: 'reread', label: 'Read this reply again' },
          ]
        : [
            { name: 'toggleAgent', label: 'Back to scrolling' },
            like,
            { name: 'instructions', label: 'Hear the instructions' },
            { name: 'account', label: 'Account settings' },
            { name: 'camera', label: 'Open the camera' },
          ];
  return platform === 'android' && view !== 'agent' ? [...labeled, { name: 'increment' }, { name: 'decrement' }] : labeled;
}
