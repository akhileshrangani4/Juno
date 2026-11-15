import { router } from 'expo-router';

import type { CameraController, KeptPhoto } from './CameraController';

// How the camera screen reaches the feed screen behind it, which owns the voice agent, and how the agent's tools
// reach the camera. The camera is its own route, so the feed screen stays mounted under it with the same post in
// focus and a live call stays live.

export type CameraHost = {
  // Called just before the camera opens, so the feed falls silent before the camera starts speaking.
  cover(): void;
  agentLive(): boolean;
  say(text: string): boolean;
  wakeAgent(): void;
  sleepAgent(): void;
  // A photo kept or chosen: back to the feed and on to the publishing flow.
  keep(photo: KeptPhoto): void;
  // Leaving the camera without a photo; the feed says where the user is.
  closed(): void;
};

let host: CameraHost | null = null;
let active: CameraController | null = null;
let pending: KeptPhoto | null = null;
let opening = false;

export function registerCameraHost(next: CameraHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

export const cameraHost = () => host;

export function setActiveCamera(controller: CameraController | null): void {
  active = controller;
  opening = false;
}

export const activeCamera = () => active;

// Opens the camera, or the photo library inside it, over the feed. Called by the feed's VoiceOver action and
// gesture and by the agent's camera tool.
export function openCamera({ library = false }: { library?: boolean } = {}): boolean {
  if (active || opening) return false;
  opening = true;
  host?.cover();
  router.push({ pathname: '/camera', params: library ? { start: 'library' } : {} });
  return true;
}

// The photo waiting to be posted, attached to the next post the agent drafts.
export const pendingPhoto = () => pending;

export function setPendingPhoto(photo: KeptPhoto | null): void {
  pending = photo;
}
