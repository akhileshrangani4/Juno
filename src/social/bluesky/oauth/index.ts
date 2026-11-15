import type { OAuthClient } from '@atproto/oauth-client';
import { getRandomBytes } from 'expo-crypto';
import { openAuthSessionAsync } from 'expo-web-browser';

import type { KeyValueStore } from '@/storage/keyValueStore';

import { createOAuthClient } from './createOAuthClient';

export type RedirectUri = OAuthClient['clientMetadata']['redirect_uris'][number];

export type AuthSessionResult = { type: string; url?: string };

export type BlueskyOAuth = {
  client: Pick<OAuthClient, 'authorize' | 'callback' | 'restore' | 'revoke' | 'identityResolver'>;
  redirectUri: RedirectUri;
  openAuthSession(url: string, redirectUri: string): Promise<AuthSessionResult>;
};

export type BlueskyOAuthFactory = (options: { store: KeyValueStore; onSessionDeleted(sub: string): void }) => BlueskyOAuth;

export function createBlueskyOAuth(origin: string): BlueskyOAuthFactory {
  return ({ store, onSessionDeleted }) => {
    const client = createOAuthClient({ origin, store, randomBytes: getRandomBytes, onSessionDeleted });
    return {
      client,
      redirectUri: client.clientMetadata.redirect_uris[0],
      openAuthSession: (url, redirectUri) => openAuthSessionAsync(url, redirectUri, { preferEphemeralSession: false, dismissButtonStyle: 'cancel' }),
    };
  };
}
