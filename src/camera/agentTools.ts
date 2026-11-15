import type { CameraTools } from '@/agent/toolHandlers';

import { activeCamera, openCamera, pendingPhoto, setPendingPhoto } from './host';

const SAY_NOTHING = 'The app is doing it on the phone and tells the user. Say nothing.';
const CLOSED = "CAMERA_CLOSED: The camera isn't open. Offer to open it.";

// The agent's camera tool. Each action runs on the phone; the camera speaks for itself through the call.
export function createCameraTools(): CameraTools {
  return {
    run(action, subject) {
      const camera = activeCamera();
      if (action === 'open') return camera ? `ALREADY_OPEN: The camera is already open.` : openCamera() ? `OPENING: ${SAY_NOTHING}` : CLOSED;
      if (action === 'photos') {
        if (camera) void camera.openLibrary();
        else if (!openCamera({ library: true })) return CLOSED;
        return `OPENING_PHOTOS: ${SAY_NOTHING}`;
      }
      if (!camera) return CLOSED;
      switch (action) {
        case 'describe':
          camera.askWhatIsInView();
          break;
        case 'check':
          if (!subject) return 'NO_SUBJECT: Ask what they want to check for, then call check with it as subject.';
          camera.ask(subject);
          break;
        case 'shutter':
          void camera.shutter();
          break;
        case 'flip':
          camera.flip();
          break;
        case 'keep':
          void camera.keep();
          break;
        case 'retake':
          camera.retake();
          break;
        case 'next':
          camera.libraryMove('older');
          break;
        case 'previous':
          camera.libraryMove('newer');
          break;
        case 'choose':
          void camera.choose();
          break;
        case 'descriptions_on':
        case 'descriptions_off':
          camera.answerConsent(action === 'descriptions_on' ? 'yes' : 'no');
          break;
        case 'close':
          camera.close();
          break;
        default:
          return `UNKNOWN_ACTION: There is no camera action called ${action}.`;
      }
      return `DONE: ${SAY_NOTHING}`;
    },
    photo() {
      const photo = pendingPhoto();
      return photo ? { uri: photo.uri, mimeType: photo.mimeType, alt: photo.altText } : null;
    },
    photoUsed() {
      setPendingPhoto(null);
    },
  };
}

// The waiting photo, as the agent's prompt describes it.
export function describePendingPhoto(): string | null {
  const photo = pendingPhoto();
  if (!photo) return null;
  return `a photo ${photo.source === 'camera' ? 'they just took' : 'they chose from their library'}${photo.description ? `, described as: ${photo.description}` : ', not described'}. It is attached to the next draft_post.`;
}
