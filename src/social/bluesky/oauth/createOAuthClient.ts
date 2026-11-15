import './polyfills';

import { OAuthClient, type Fetch } from '@atproto/oauth-client';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

import type { KeyValueStore } from '@/storage/keyValueStore';

import { oauthClientMetadata } from '../../../../convex/oauthClientMetadata';
import { NobleKey, type RandomBytes } from './NobleKey';
import { createSessionStore, createStateStore } from './stores';

const digests = { sha256, sha384, sha512 };

export type OAuthClientOptions = {
  origin: string;
  store: KeyValueStore;
  randomBytes: RandomBytes;
  handleResolver?: string;
  fetch?: Fetch;
  onSessionDeleted?: (sub: string) => void;
};

export class NetworkError extends Error {}

export function createOAuthClient({ origin, store, randomBytes, handleResolver = 'https://bsky.social', fetch = globalThis.fetch, onSessionDeleted }: OAuthClientOptions): OAuthClient {
  return new OAuthClient({
    clientMetadata: oauthClientMetadata(origin),
    responseMode: 'query',
    handleResolver,
    runtimeImplementation: {
      createKey: (algs) => NobleKey.generate(algs, randomBytes),
      getRandomValues: randomBytes,
      digest: (bytes, { name }) => digests[name](bytes),
    },
    stateStore: createStateStore(),
    sessionStore: createSessionStore(store),
    fetch: (input, init) =>
      fetch(input, init).catch((error: unknown) => {
        throw new NetworkError('Could not reach the server', { cause: error });
      }),
    onSessionDeleted,
  });
}
