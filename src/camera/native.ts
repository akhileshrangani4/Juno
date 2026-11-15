import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';

import type { Analysis, Box } from './guidance';

// Bindings to modules/juno-camera, the Swift module that runs the camera and Apple's Vision framework on the
// phone. It exists only in iOS builds; everywhere else (tests, web, Android) these are null and the camera screen
// says the camera isn't available.

export type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'undetermined';
export type Snapshot = { base64: string; width: number; height: number };
export type Photo = { uri: string; width: number; height: number };

type RawAnalysis = { faces: Box[]; salient: Box | null; sharpness: number; brightness: number; motion: number; signature: number[]; width: number; height: number; timestamp: number };

type NativeModule = {
  cameraPermission(): PermissionStatus;
  requestCameraPermission(): Promise<boolean>;
  allowHapticsDuringRecording(allow: boolean): void;
  analyzeImage(uri: string): Promise<RawAnalysis>;
};

export type CameraViewHandle = {
  snapshot(maxDimension: number, mirror: boolean): Promise<Snapshot>;
  takePhoto(): Promise<Photo>;
};

export type CameraViewProps = ViewProps & {
  ref?: Ref<CameraViewHandle>;
  facing: 'back' | 'front';
  active: boolean;
  onAnalysis(event: { nativeEvent: RawAnalysis }): void;
  onReady?(event: { nativeEvent: { facing: 'back' | 'front' } }): void;
  onCameraError?(event: { nativeEvent: { reason: 'permission' | 'unavailable' } }): void;
};

export const cameraModule = requireOptionalNativeModule<NativeModule>('JunoCamera');

export const NativeCameraView: ComponentType<CameraViewProps> | null = cameraModule ? requireNativeView<CameraViewProps>('JunoCamera') : null;

export const toAnalysis = (raw: RawAnalysis): Analysis => ({
  faces: raw.faces,
  salient: raw.salient,
  sharpness: raw.sharpness,
  brightness: raw.brightness,
  motion: raw.motion,
  signature: raw.signature,
  at: raw.timestamp,
});
