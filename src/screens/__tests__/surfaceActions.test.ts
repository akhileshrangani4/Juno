import { surfaceActions } from '../surfaceActions';

const labels = (mode: 'scroll' | 'agent', platform: string) => surfaceActions(mode, platform).map((action) => action.label);

describe('surfaceActions', () => {
  it('gives the VoiceOver rotor only human labels, each once', () => {
    for (const mode of ['scroll', 'agent'] as const) {
      const actions = surfaceActions(mode, 'ios');
      expect(actions.every((action) => action.label)).toBe(true);
      expect(new Set(labels(mode, 'ios')).size).toBe(actions.length);
      expect(actions.map((action) => action.name)).not.toEqual(expect.arrayContaining(['increment', 'decrement', 'magicTap', 'escape', 'activate']));
    }
  });

  it('lists the scroll actions and the agent actions', () => {
    expect(labels('scroll', 'ios')).toEqual(['Next post', 'Previous post', 'Read this post again', 'Wake the agent', 'Open the camera']);
    expect(labels('agent', 'ios')).toEqual(['Back to scrolling', 'Hear the instructions', 'Account settings', 'Open the camera']);
  });

  it('adds the standard adjustable actions on Android only', () => {
    expect(surfaceActions('scroll', 'android').map((action) => action.name)).toEqual(expect.arrayContaining(['increment', 'decrement']));
  });
});
