import type { InternalStateData, Session, SessionStore, StateStore } from '@atproto/oauth-client';

import type { KeyValueStore } from '@/storage/keyValueStore';

import { NobleKey } from './NobleKey';

export const OAUTH_SESSION_KEY = 'bluesky.oauth.session';

type StoredSession = { sub: string; dpopJwk: NobleKey['jwk']; authMethod: Session['authMethod']; tokenSet: Session['tokenSet'] };

export function createSessionStore(store: KeyValueStore): SessionStore {
  const read = async (): Promise<StoredSession | null> => {
    const saved = await store.get(OAUTH_SESSION_KEY);
    return saved ? (JSON.parse(saved) as StoredSession) : null;
  };
  return {
    async get(sub) {
      const saved = await read();
      if (!saved || saved.sub !== sub) return undefined;
      return { dpopKey: new NobleKey(saved.dpopJwk), authMethod: saved.authMethod, tokenSet: saved.tokenSet };
    },
    async set(sub, { dpopKey, authMethod, tokenSet }) {
      const stored: StoredSession = { sub, dpopJwk: (dpopKey as NobleKey).jwk, authMethod, tokenSet };
      await store.set(OAUTH_SESSION_KEY, JSON.stringify(stored));
    },
    async del(sub) {
      const saved = await read();
      if (!saved || saved.sub === sub) await store.remove(OAUTH_SESSION_KEY);
    },
    async clear() {
      await store.remove(OAUTH_SESSION_KEY);
    },
  };
}

export function createStateStore(): StateStore {
  const states = new Map<string, InternalStateData>();
  return {
    get: (key) => states.get(key),
    set: (key, value) => void states.set(key, value),
    del: (key) => void states.delete(key),
    clear: () => states.clear(),
  };
}
