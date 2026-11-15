import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';

import type { SocialAccount } from '@/social/types';

import { api } from '../../convex/_generated/api';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const DESCRIPTION_TIMEOUT_MS = 1500;

export const convex = url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null;

export function BackendProvider({ children }: { children: ReactNode }) {
  return convex ? <ConvexProvider client={convex}>{children}</ConvexProvider> : children;
}

export async function fetchCachedDescription(postUri: string): Promise<string | null> {
  if (!convex) return null;
  const lookup = convex.query(api.postDescriptions.getByUri, { postUri }).then(
    (cached) => cached?.description ?? null,
    () => null,
  );
  return Promise.race([lookup, new Promise<null>((resolve) => setTimeout(() => resolve(null), DESCRIPTION_TIMEOUT_MS))]);
}

export function recordUser(provider: string, account: SocialAccount): void {
  convex?.mutation(api.users.upsert, { provider, providerUserId: account.id, handle: account.handle }).catch(() => undefined);
}
