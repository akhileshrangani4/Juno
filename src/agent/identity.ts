import 'react-native-get-random-values';

import type { SocialAccount } from '@/social/types';
import type { KeyValueStore } from '@/storage/keyValueStore';

const DEVICE_KEY = 'agent.deviceId';

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function stored(store: KeyValueStore, key: string): Promise<string> {
  const existing = await store.get(key).catch(() => null);
  if (existing) return existing;
  const fresh = randomHex(24);
  await store.set(key, fresh);
  return fresh;
}

// Memories are keyed by the Bluesky DID when signed in and by a random device id otherwise. Each key comes
// with a secret kept in this device's keychain, which the backend requires before it reads or writes.
export async function memoryIdentity(store: KeyValueStore, account: SocialAccount | null): Promise<{ userKey: string; secret: string }> {
  const userKey = account ? `bsky:${account.id}` : `device:${await stored(store, DEVICE_KEY)}`;
  return { userKey, secret: await stored(store, `agent.memorySecret.${userKey.replace(/[^a-zA-Z0-9.]/g, '_')}`) };
}
