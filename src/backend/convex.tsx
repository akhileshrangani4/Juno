import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';

import type { DescriptionParts, DetailLevel } from '@/narration/buildNarration';
import type { SocialAccount } from '@/social/types';
import { secureStore } from '@/storage/keyValueStore';

import { api } from '../../convex/_generated/api';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const DESCRIBE_TIMEOUT_MS = 40_000;
const DEVICE_ID_KEY = 'app.deviceId';

export const convex = url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null;

export function BackendProvider({ children }: { children: ReactNode }) {
  return convex ? <ConvexProvider client={convex}>{children}</ConvexProvider> : children;
}

let deviceId: Promise<string> | null = null;

export function getDeviceId(): Promise<string> {
  deviceId ??= secureStore
    .get(DEVICE_ID_KEY)
    .catch(() => null)
    .then((saved) => {
      if (saved) return saved;
      const fresh = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      secureStore.set(DEVICE_ID_KEY, fresh).catch(() => undefined);
      return fresh;
    });
  return deviceId;
}

export async function describePost(uri: string, detail: DetailLevel): Promise<DescriptionParts | null> {
  if (!convex) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), DESCRIBE_TIMEOUT_MS)));
  const request = getDeviceId()
    .then((id) => convex.action(api.describe.describePost, { uri, detail, deviceId: id }))
    .then((result) => result?.parts ?? null)
    .catch(() => null);
  const parts = await Promise.race([request, timeout]);
  clearTimeout(timer);
  return parts;
}

export function recordUser(provider: string, account: SocialAccount): void {
  convex?.mutation(api.users.upsert, { provider, providerUserId: account.id, handle: account.handle }).catch(() => undefined);
}
