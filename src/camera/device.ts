import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { getAssetsAsync, getAssetInfoAsync, getPermissionsAsync, requestPermissionsAsync, SortBy, MediaType } from 'expo-media-library/legacy';
import { Platform } from 'react-native';

import type { KeyValueStore } from '@/storage/keyValueStore';

import type { Consent, ControllerDeps, LibraryPermission, Photo } from './CameraController';
import type { LibraryPhoto, LibrarySource } from './library';
import { downscaled, LOOK } from './lookClient';
import { cameraModule } from './native';

// The camera's connections to the phone: haptics, the shutter sound, permissions, the privacy answer, and the
// photo library through expo-media-library.

let shutterPlayer: AudioPlayer | null = null;

// The shutter sound is the app's own, so it plays in silent mode too. During a voice call the call owns the
// audio session, so the app plays nothing itself: iOS plays the camera's own shutter sound, which the camera
// module allows during recording.
function playShutter(inCall: boolean): void {
  if (Platform.OS === 'web' || inCall) return;
  try {
    if (!shutterPlayer) {
      setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
      shutterPlayer = createAudioPlayer(require('../../assets/sounds/earcon-shutter.wav'));
      shutterPlayer.volume = 0.7;
    }
    void shutterPlayer.seekTo(0).catch(() => undefined);
    shutterPlayer.play();
  } catch {
    shutterPlayer = null;
  }
}

const quietly = (run: () => Promise<unknown>) => {
  if (Platform.OS !== 'web') run().catch(() => undefined);
};

export function cameraFeedback(inCall: () => boolean): ControllerDeps['feedback'] {
  return {
    tick: () => quietly(() => Haptics.selectionAsync()),
    shutter: () => {
      quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
      playShutter(inCall());
    },
    edge: () => quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
    confirm: () => quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  };
}

export const localStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

const CONSENT_KEY = 'camera.sendPictures';

export const consentStore: ControllerDeps['consent'] = {
  get: async () => {
    const value = await localStore.get(CONSENT_KEY).catch(() => null);
    return value === 'yes' || value === 'no' ? (value as Consent) : null;
  },
  set: (answer) => localStore.set(CONSENT_KEY, answer).catch(() => undefined),
};

function libraryPermission(response: { granted: boolean; canAskAgain: boolean; accessPrivileges?: 'all' | 'limited' | 'none' }): LibraryPermission {
  if (response.accessPrivileges === 'limited') return 'limited';
  if (response.granted) return 'granted';
  return response.canAskAgain ? 'undetermined' : 'denied';
}

export const permissions: ControllerDeps['permissions'] = {
  camera: () => cameraModule?.cameraPermission() ?? 'unavailable',
  requestCamera: () => cameraModule?.requestCameraPermission() ?? Promise.resolve(false),
  library: () => getPermissionsAsync(false).then(libraryPermission, () => 'denied' as const),
  requestLibrary: () => requestPermissionsAsync(false).then(libraryPermission, () => 'denied' as const),
};

async function localPhoto(id: string): Promise<Photo | null> {
  try {
    const info = await getAssetInfoAsync(id, { shouldDownloadFromNetwork: true });
    return info.localUri ? { uri: info.localUri, width: info.width, height: info.height } : null;
  } catch {
    return null;
  }
}

export const mediaLibrary: LibrarySource & { file(id: string): Promise<Photo | null> } = {
  async recent(count) {
    const page = await getAssetsAsync({ first: count, mediaType: MediaType.photo, sortBy: [[SortBy.creationTime, false]] });
    return page.assets.map((asset): LibraryPhoto => ({ id: asset.id, uri: asset.uri, takenAt: asset.creationTime, width: asset.width, height: asset.height }));
  },
  async image(photo) {
    const file = await localPhoto(photo.id);
    return file ? downscaled(file.uri, file, LOOK.describeMaxPx) : null;
  },
  file: localPhoto,
};
