export type Mode = 'scroll' | 'agent';

export type SurfaceActionName = 'next' | 'previous' | 'reread' | 'toggleAgent' | 'instructions' | 'account' | 'camera' | 'increment' | 'decrement';

export type SurfaceAction = { name: SurfaceActionName; label?: string };

export function surfaceActions(mode: Mode, platform: string): SurfaceAction[] {
  const labeled: SurfaceAction[] =
    mode === 'scroll'
      ? [
          { name: 'next', label: 'Next post' },
          { name: 'previous', label: 'Previous post' },
          { name: 'reread', label: 'Read this post again' },
          { name: 'toggleAgent', label: 'Wake the agent' },
          { name: 'camera', label: 'Open the camera' },
        ]
      : [
          { name: 'toggleAgent', label: 'Back to scrolling' },
          { name: 'instructions', label: 'Hear the instructions' },
          { name: 'account', label: 'Account settings' },
          { name: 'camera', label: 'Open the camera' },
        ];
  return platform === 'android' ? [...labeled, { name: 'increment' }, { name: 'decrement' }] : labeled;
}
