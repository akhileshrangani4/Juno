import { cameraActions, cameraHalves, cameraHint } from '../actions';
import type { Phase } from '../CameraController';

const phases: Phase[] = ['starting', 'permission', 'consent', 'aiming', 'unavailable', 'capturing', 'reviewing', 'library', 'closed'];

describe('camera actions and hints', () => {
  it('give every phase a way out and only labeled, distinct actions', () => {
    for (const phase of phases) {
      const actions = cameraActions(phase, true, true);
      expect(actions.map((action) => action.name)).toContain('close');
      expect(actions.every((action) => action.label)).toBe(true);
      expect(new Set(actions.map((action) => action.label)).size).toBe(actions.length);
    }
  });

  it('mirror every tap as an action', () => {
    expect(cameraActions('aiming', true, true).map((action) => action.label)).toEqual(expect.arrayContaining(['Take the picture', 'Switch camera']));
    expect(cameraActions('reviewing', true, true).map((action) => action.label)).toEqual(expect.arrayContaining(['Keep it', 'Take another']));
    expect(cameraActions('library', true, true).map((action) => action.label)).toEqual(expect.arrayContaining(['Next photo', 'Previous photo', 'Choose this photo']));
    expect(cameraActions('consent', true, true).map((action) => action.label)).toEqual(expect.arrayContaining(['Allow descriptions', 'Keep pictures on my phone']));
  });

  it('offer the opposite of the current privacy answer', () => {
    expect(cameraActions('aiming', true, true).map((action) => action.name)).toContain('descriptionsOff');
    expect(cameraActions('aiming', false, true).map((action) => action.name)).toContain('descriptionsOn');
  });

  it('say what each half does and how to leave', () => {
    expect(cameraHalves('aiming')).toEqual({ top: 'switch cameras', bottom: 'take the picture' });
    expect(cameraHint('aiming', false)).toBe('Tap the bottom half to take the picture, the top half to switch cameras. Draw a counter-clockwise circle to go back to your feed.');
    expect(cameraHint('library', true)).toBe(
      'Tap the bottom half to go to the next photo, the top half to go to the previous photo. Press and hold to choose this photo. Say close the camera to go back to your feed.',
    );
  });
});
