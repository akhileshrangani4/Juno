import type { CameraTools } from '@/agent/toolHandlers';

import { activeCamera, openCamera, pendingPhoto, setPendingPhoto } from './host';

const SAY_NOTHING = 'The app is doing it on the phone and tells the user. Say nothing.';
const TOLD = 'The app told the user. Say nothing.';

// The agent's camera tool. Each action runs on the phone; the camera speaks for itself, and every other answer
// (the camera isn't open, a photo waiting to be posted) is spoken by the app, so none of them depends on the model.
export function createCameraTools(): CameraTools {
  // With the camera closed: what happens to the photo waiting in a draft, if there is one.
  function closed(action: string): { result: string; speak?: string } {
    const photo = pendingPhoto();
    if (!photo) return { result: `CAMERA_CLOSED: The camera isn't open, and the app told the user how to open it. ${TOLD}`, speak: "The camera isn't open. Say open the camera to use it." };
    switch (action) {
      case 'retake':
      case 'shutter':
        if (!openCamera()) return { result: `CAMERA_BUSY: ${TOLD}`, speak: "The camera can't open right now. Try again." };
        return { result: `OPENING_TO_RETAKE: The camera is opening. The waiting draft stays until the user keeps a new photo, which replaces it. ${SAY_NOTHING}`, speak: 'Opening the camera. Your draft stays until you keep a new photo, which replaces it.' };
      case 'describe':
        return {
          result: `PHOTO_DESCRIBED: The app read the waiting photo's description to the user. ${TOLD}`,
          speak: photo.description ? `The photo in your draft shows ${photo.description}` : "The photo in your draft has no description. You can tell me what it should say.",
        };
      case 'keep':
      case 'choose':
        return { result: `ALREADY_KEPT: ${TOLD}`, speak: 'The photo is already kept and waiting in your draft.' };
      case 'close':
        return { result: `ALREADY_CLOSED: ${TOLD}`, speak: 'The camera is already closed. Your photo is still waiting in your draft.' };
      default:
        return { result: `CAMERA_CLOSED: ${TOLD}`, speak: "The camera isn't open. Your photo is still waiting in your draft. Say take another to replace it." };
    }
  }

  return {
    run(action, subject) {
      const camera = activeCamera();
      if (action === 'open') {
        if (camera) return { result: `ALREADY_OPEN: ${TOLD}`, speak: 'The camera is already open.' };
        return openCamera() ? { result: `OPENING: ${SAY_NOTHING}` } : { result: `CAMERA_BUSY: ${TOLD}`, speak: "The camera can't open right now. Try again." };
      }
      if (action === 'photos') {
        if (camera) void camera.openLibrary();
        else if (!openCamera({ library: true })) return { result: `CAMERA_BUSY: ${TOLD}`, speak: "Your photos can't open right now. Try again." };
        return { result: `OPENING_PHOTOS: ${SAY_NOTHING}` };
      }
      if (!camera) return closed(action);
      switch (action) {
        case 'describe':
          camera.askWhatIsInView();
          break;
        case 'check':
          if (!subject) return { result: 'NO_SUBJECT: The app asked the user what to check for. When they say it, call check with it as subject. Say nothing now.', speak: 'What should I check for?' };
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
          void camera.libraryMove('older');
          break;
        case 'previous':
          void camera.libraryMove('newer');
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
          return { result: `UNKNOWN_ACTION: There is no camera action called ${action}. Nothing happened; tell the user in a few words.` };
      }
      return { result: `DONE: ${SAY_NOTHING}` };
    },
    photo() {
      const photo = pendingPhoto();
      return photo ? { uri: photo.uri, mimeType: photo.mimeType, alt: photo.altText, width: photo.width, height: photo.height } : null;
    },
    photoUsed(uri) {
      if (pendingPhoto()?.uri === uri) setPendingPhoto(null);
    },
    isOpen: () => activeCamera() !== null,
  };
}

// The waiting photo, as the agent's prompt describes it.
export function describePendingPhoto(): string | null {
  const photo = pendingPhoto();
  if (!photo) return null;
  return `a photo ${photo.source === 'camera' ? 'they just took' : 'they chose from their library'}${photo.description ? `, described as: ${photo.description}` : ', not described'}. It is attached to the next draft_post.`;
}
