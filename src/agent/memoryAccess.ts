import 'react-native-get-random-values';

import { PermissionMissingError, type SocialAccount } from '@/social/types';
import type { KeyValueStore } from '@/storage/keyValueStore';

import { MEMORY_METHOD } from '../../convex/memoryService';
import { MemorySignInNeededError, MemoryUnavailableError } from './memoryClient';

// What the phone shows Convex to use a memory (convex/memoryAuth.ts checks it).
// - Signed out: a random device id with a secret, both kept in this device's keychain.
// - Signed in: the account's DID, a proof from the account's own Bluesky server (a 60-second service-auth token
//   for Juno's memory method and this deployment), and a random session secret made here. The first call opens
//   the session; later calls until the proof expires need no new proof. Nothing from the Bluesky session itself
//   (access or refresh tokens, DPoP keys, the app password) is ever sent.

export type DeviceAccess = { kind: 'device'; deviceId: string; secret: string };
export type AccountAccess = { kind: 'account'; did: string; session: string; proof: string };
export type MemoryAccess = DeviceAccess | AccountAccess;

const DEVICE_KEY = 'agent.deviceId';
// A proof is replaced this long before it expires, so a call never arrives with one that just ran out.
const RENEW_BEFORE_MS = 10_000;

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function stored(store: KeyValueStore, key: string): Promise<string> {
  const existing = await store.get(key).catch(() => null);
  if (existing) return existing;
  const fresh = randomHex(24);
  await store.set(key, fresh);
  return fresh;
}

// How long the server signed the token for (exp minus iat), measured on the server's clock so the phone's own
// clock doesn't matter. Tokens without iat count as 60 seconds, the server default.
export function proofLifetimeMs(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp, iat } = JSON.parse(atob(payload)) as { exp?: number; iat?: number };
    return typeof exp === 'number' && typeof iat === 'number' ? Math.max(0, (exp - iat) * 1000) : 60_000;
  } catch {
    return 0;
  }
}

export type MemoryAccessSource = ReturnType<typeof createMemoryAccess>;

export function createMemoryAccess(deps: {
  store: KeyValueStore;
  account(): SocialAccount | null;
  serviceAuth(request: { aud: string; lxm: string }): Promise<string>;
  // The deployment's memory audience, or null when the app has no Convex URL.
  audience: string | null;
  now(): number;
}) {
  let current: (AccountAccess & { renewAt: number }) | null = null;
  let pending: Promise<AccountAccess> | null = null;

  async function device(): Promise<DeviceAccess> {
    const deviceId = await stored(deps.store, DEVICE_KEY);
    return { kind: 'device', deviceId, secret: await stored(deps.store, `agent.memorySecret.device_${deviceId}`) };
  }

  function prove(did: string): Promise<AccountAccess> {
    pending ??= (async () => {
      const audience = deps.audience;
      if (!audience) throw new MemoryUnavailableError('Memory has no server');
      const startedAt = deps.now();
      const proof = await deps.serviceAuth({ aud: audience, lxm: MEMORY_METHOD }).catch((error: unknown) => {
        if (error instanceof PermissionMissingError) throw new MemorySignInNeededError('The sign-in lacks the memory permission', { cause: error });
        throw new MemoryUnavailableError('No proof of the account', { cause: error });
      });
      current = { kind: 'account', did, session: randomHex(32), proof, renewAt: startedAt + proofLifetimeMs(proof) - RENEW_BEFORE_MS };
      return current;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function account(did: string): Promise<AccountAccess> {
    const reusable = current?.did === did && deps.now() < current.renewAt ? current : null;
    const { kind, session, proof } = reusable ?? (await prove(did));
    return { kind, did, session, proof };
  }

  return {
    device,
    // Signed in: the account, or a MemoryUnavailableError. Never the device's key instead.
    async account(): Promise<AccountAccess> {
      const signedIn = deps.account();
      if (!signedIn) throw new MemoryUnavailableError('Not signed in');
      return account(signedIn.id);
    },
    async current(): Promise<MemoryAccess> {
      const signedIn = deps.account();
      return signedIn ? account(signedIn.id) : device();
    },
    // The server no longer knows the session: get a new proof.
    async renew(): Promise<AccountAccess> {
      current = null;
      return this.account();
    },
  };
}
