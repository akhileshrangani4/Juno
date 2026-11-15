import type { Phase } from './CameraController';

// The camera's VoiceOver actions, one list per phase, each with a human label. Every gesture on the camera has
// an action here too.

export type CameraActionName =
  | 'shutter'
  | 'describe'
  | 'flip'
  | 'photos'
  | 'descriptionsOn'
  | 'descriptionsOff'
  | 'keep'
  | 'retake'
  | 'next'
  | 'previous'
  | 'choose'
  | 'backToCamera'
  | 'allow'
  | 'decline'
  | 'settings'
  | 'close';

export type CameraAction = { name: CameraActionName; label: string };

const close: CameraAction = { name: 'close', label: 'Close the camera' };

export function cameraActions(phase: Phase, descriptionsOn: boolean, hasCamera: boolean): CameraAction[] {
  switch (phase) {
    case 'aiming':
      return [
        { name: 'shutter', label: 'Take the picture' },
        { name: 'describe', label: 'What do you see?' },
        { name: 'flip', label: 'Switch camera' },
        { name: 'photos', label: 'Choose from my photos' },
        descriptionsOn ? { name: 'descriptionsOff', label: 'Turn descriptions off' } : { name: 'descriptionsOn', label: 'Turn descriptions on' },
        close,
      ];
    case 'reviewing':
      return [{ name: 'keep', label: 'Keep it' }, { name: 'retake', label: 'Take another' }, { name: 'describe', label: 'Describe the photo again' }, close];
    case 'library':
      return [
        { name: 'next', label: 'Next photo' },
        { name: 'previous', label: 'Previous photo' },
        { name: 'choose', label: 'Choose this photo' },
        { name: 'describe', label: 'Describe this photo again' },
        descriptionsOn ? { name: 'descriptionsOff', label: 'Turn descriptions off' } : { name: 'descriptionsOn', label: 'Turn descriptions on' },
        ...(hasCamera ? [{ name: 'backToCamera', label: 'Back to the camera' } as const] : []),
        close,
      ];
    case 'consent':
      return [{ name: 'allow', label: 'Allow descriptions' }, { name: 'decline', label: 'Keep pictures on my phone' }, close];
    case 'unavailable':
      return [{ name: 'photos', label: 'Choose from my photos' }, { name: 'settings', label: 'Open Settings' }, close];
    default:
      return [close];
  }
}

// What the two halves of the screen do in each phase, as verb phrases for the hint and the on-screen labels.
export function cameraHalves(phase: Phase): { top: string; bottom: string } | null {
  switch (phase) {
    case 'aiming':
      return { top: 'switch cameras', bottom: 'take the picture' };
    case 'reviewing':
      return { top: 'take another', bottom: 'keep it' };
    case 'library':
      return { top: 'go to the previous photo', bottom: 'go to the next photo' };
    case 'consent':
      return { top: 'hear the question again', bottom: 'hear the question again' };
    case 'unavailable':
      return { top: 'hear this again', bottom: 'choose from your photos' };
    default:
      return null;
  }
}

export function cameraHint(phase: Phase, inCall: boolean): string {
  const halves = cameraHalves(phase);
  const leave = inCall ? 'Say close the camera to go back to your feed.' : 'Draw a counter-clockwise circle to go back to your feed.';
  const hold = phase === 'library' ? ' Press and hold to choose this photo.' : '';
  if (phase === 'consent') return `Use the action Allow descriptions or Keep pictures on my phone to answer. A tap repeats the question. ${leave}`;
  return halves ? `Tap the bottom half to ${halves.bottom}, the top half to ${halves.top}.${hold} ${leave}` : leave;
}
