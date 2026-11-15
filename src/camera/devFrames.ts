import { Asset } from 'expo-asset';

import type { Analysis } from './guidance';
import { cameraModule, toAnalysis } from './native';

// Development and test builds only: a cloud iPhone has no camera, so with EXPO_PUBLIC_DEV_FRAME_SOURCE=1 the
// camera screen shows the bundled test images in assets/dev-frames one after another instead, and each goes
// through the whole pipeline: Apple Vision measurements (the camera module's analyzeImage), cues, haptic ticks,
// descriptions, checks and the shutter. The variable is inlined at build time, so in a build without it the
// condition below is the constant false, the bundler drops the block and with it the images, and the real
// camera is used. It is also off unless the native module was built for a simulator (devFramesSupported, set only
// under targetEnvironment(simulator)), and scripts/build-ios-device.sh refuses to build with the variable set, so a
// build for a phone can contain neither the code path nor the images.

export const DEV_FRAME_MS = 15_000;

export type DevFrame = { name: string; uri: string; width: number; height: number; subject: string | null; analysis: Analysis | null };

export const devFramesEnabled = (): boolean => process.env.EXPO_PUBLIC_DEV_FRAME_SOURCE === '1' && cameraModule?.devFramesSupported === true;

export async function loadDevFrames(): Promise<DevFrame[]> {
  if (process.env.EXPO_PUBLIC_DEV_FRAME_SOURCE === '1' && cameraModule?.analyzeImage) {
    const analyzeImage = cameraModule.analyzeImage;
    const { DEV_FRAMES } = await import('../../assets/dev-frames');
    return Promise.all(
      DEV_FRAMES.map(async (frame): Promise<DevFrame> => {
        const asset = await Asset.fromModule(frame.source).downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        const raw = await analyzeImage(uri).catch((error: unknown) => {
          console.error(`[camera] dev frame ${frame.name} could not be analyzed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        });
        return { name: frame.name, uri, width: asset.width ?? 768, height: asset.height ?? 1024, subject: frame.subject, analysis: raw ? toAnalysis(raw) : null };
      }),
    );
  }
  return [];
}
