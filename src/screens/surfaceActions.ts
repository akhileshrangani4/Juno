export type Mode = 'scroll' | 'agent';

export type SurfaceView = 'feed' | 'comments' | 'agent';

export type SurfaceActionName = 'next' | 'previous' | 'like' | 'comments' | 'back' | 'reread' | 'readExactly' | 'toggleAgent' | 'instructions' | 'account' | 'startTalking' | 'stopTalking' | 'increment' | 'decrement';

export type SurfaceAction = { name: SurfaceActionName; label?: string };

export function surfaceActions(view: SurfaceView, platform: string, liked: boolean): SurfaceAction[] {
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
          { name: 'toggleAgent', label: 'Wake the agent' },
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
            { name: 'startTalking', label: 'Start talking' },
            { name: 'stopTalking', label: 'Stop talking' },
            like,
            { name: 'instructions', label: 'Hear the instructions' },
            { name: 'account', label: 'Account settings' },
          ];
  return platform === 'android' && view !== 'agent' ? [...labeled, { name: 'increment' }, { name: 'decrement' }] : labeled;
}
