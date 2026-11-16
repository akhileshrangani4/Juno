import { surfaceActions, type SurfaceView } from '../surfaceActions';

const labels = (view: SurfaceView, liked = false, platform = 'ios') => surfaceActions(view, platform, liked).map((action) => action.label);

describe('surfaceActions', () => {
  it('gives the VoiceOver rotor only human labels, each once', () => {
    for (const view of ['feed', 'comments', 'agent'] as const) {
      for (const liked of [false, true]) {
        const actions = surfaceActions(view, 'ios', liked);
        expect(actions.every((action) => action.label)).toBe(true);
        expect(new Set(labels(view, liked)).size).toBe(actions.length);
        expect(actions.map((action) => action.name)).not.toEqual(expect.arrayContaining(['increment', 'decrement', 'magicTap', 'escape', 'activate']));
      }
    }
  });

  it('lists the feed, comments and agent actions', () => {
    expect(labels('feed')).toEqual(['Next post', 'Previous post', 'Like', 'Open comments', 'Read this post again', 'Read exactly', 'Refresh', 'Wake the agent', 'Open the camera']);
    expect(labels('comments')).toEqual(['Next reply', 'Previous reply', 'Like', 'Back to posts', 'Read this reply again']);
    expect(labels('agent')).toEqual(['Back to scrolling', 'Like', 'Hear the instructions', 'Account settings', 'Open the camera']);
  });

  it('names the feed switch after the feed it goes to, and offers it only signed in', () => {
    const switchLabel = (feed: 'forYou' | 'following' | null) => surfaceActions('feed', 'ios', false, feed).find((action) => action.name === 'switchFeed')?.label;
    expect(switchLabel('forYou')).toBe('Switch to Following');
    expect(switchLabel('following')).toBe('Switch to For You');
    expect(switchLabel(null)).toBeUndefined();
    expect(surfaceActions('comments', 'ios', false, 'forYou').map((action) => action.name)).not.toContain('switchFeed');
  });

  it('names the like action after the like state', () => {
    expect(labels('feed', true)).toContain('Remove like');
    expect(labels('feed', true)).not.toContain('Like');
    expect(labels('comments', true)).toContain('Remove like');
  });

  it('adds the standard adjustable actions on Android only', () => {
    expect(surfaceActions('feed', 'android', false).map((action) => action.name)).toEqual(expect.arrayContaining(['increment', 'decrement']));
    expect(surfaceActions('comments', 'android', false).map((action) => action.name)).toEqual(expect.arrayContaining(['increment', 'decrement']));
  });
});
