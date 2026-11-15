import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { convex, getDeviceId } from '@/backend/convex';

import { api } from '../../convex/_generated/api';
import type { DecisionAnswer } from './checks';

// The phone's side of convex/look.ts. Every image is downscaled here before it leaves the phone; the server caps
// the size again, describes or checks it, and keeps nothing. Failures come back as null, and the camera then
// carries on with its on-device guidance.

export type Purpose = 'view' | 'photo' | 'library';
export type LookDescription = { description: string; altText: string; visibleText: string[]; latencyMs: number; costUsd: number | null };
export type Check = 'inView' | 'cutOff' | 'quality';

export const LOOK = {
  describeMaxPx: 768,
  decideMaxPx: 512,
  timeoutMs: 20_000,
  uploadMaxBytes: 950_000,
};

export type LookClient = {
  describe(image: string, purpose: Purpose): Promise<LookDescription | null>;
  decide(image: string, subject: string | null, checks: Check[]): Promise<(DecisionAnswer & { latencyMs: number; costUsd: number | null }) | null>;
};

const logLine = process.env.EXPO_PUBLIC_DEV_FRAME_SOURCE === '1' || process.env.EXPO_PUBLIC_DEV_AGENT_LINK === '1' ? console.error : console.log;

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), LOOK.timeoutMs)));
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

export const convexLook: LookClient = {
  async describe(image, purpose) {
    if (!convex) return null;
    const client = convex;
    const result = await withTimeout(getDeviceId().then((deviceId) => client.action(api.look.describeImage, { image, deviceId, purpose })));
    if (!result?.ok) {
      logLine(`[camera] describe ${purpose} unavailable ${result ? result.reason : 'timeout or error'}`);
      return null;
    }
    return { description: result.description, altText: result.altText, visibleText: result.visibleText, latencyMs: result.latencyMs, costUsd: result.costUsd };
  },
  async decide(image, subject, checks) {
    if (!convex) return null;
    const client = convex;
    const result = await withTimeout(getDeviceId().then((deviceId) => client.action(api.look.decide, { image, deviceId, subject, checks })));
    if (!result?.ok) {
      logLine(`[camera] decide unavailable ${result ? result.reason : 'timeout or error'}`);
      return null;
    }
    return { inView: result.inView, cutOff: result.cutOff, tooDark: result.tooDark, tooBlurry: result.tooBlurry, latencyMs: result.latencyMs, costUsd: result.costUsd };
  },
};

const longSide = (width: number, height: number, max: number) => (width >= height ? { width: Math.min(width, max) } : { height: Math.min(height, max) });

// A base64 JPEG of a photo file, no larger than maxPx on its long side, for a description or a check.
export async function downscaled(uri: string, size: { width: number; height: number }, maxPx: number): Promise<string | null> {
  try {
    const result = await manipulateAsync(uri, [{ resize: longSide(size.width, size.height, maxPx) }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    return result.base64 ?? null;
  } catch {
    return null;
  }
}

// A JPEG under Bluesky's one-megabyte image limit, for the post itself.
export async function forUpload(uri: string, size: { width: number; height: number }): Promise<{ uri: string; width: number; height: number } | null> {
  for (const [maxPx, compress] of [
    [2000, 0.8],
    [1600, 0.7],
    [1200, 0.6],
  ] as const) {
    try {
      const result = await manipulateAsync(uri, [{ resize: longSide(size.width, size.height, maxPx) }], { compress, format: SaveFormat.JPEG, base64: true });
      if (result.base64 && (result.base64.length * 3) / 4 <= LOOK.uploadMaxBytes) return { uri: result.uri, width: result.width, height: result.height };
    } catch {
      return null;
    }
  }
  return null;
}
