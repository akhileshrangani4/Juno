import type { SocialAccount } from '@/social/types';
import type { KeyValueStore } from '@/storage/keyValueStore';

import type { MemoryClient } from './memoryClient';

// Someone who used Juno signed out has memories under this phone's own key. After they sign in, the agent's first
// words ask whether to keep them with the account, and they move only on a plain yes (toolHandlers.ts,
// answer_memory_offer). A no keeps them on the phone for signed-out use, and the question isn't asked again
// for that account.

// Set when something is remembered while signed out, so a signed-in conversation only checks when there's a
// chance of something to offer.
export const SIGNED_OUT_MEMORIES = 'agent.signedOutMemories';

const declinedKey = (did: string) => `agent.carryOverDeclined.${did.replace(/[^a-zA-Z0-9.]/g, '_')}`;

export function offerQuestion(count: number): string {
  return count === 1
    ? 'Before you signed in, you asked me to remember one thing on this phone. Shall I keep it with your account?'
    : `Before you signed in, you asked me to remember ${count} things on this phone. Shall I keep them with your account?`;
}

export type MemoryOffer = ReturnType<typeof createMemoryOffer>;

export function createMemoryOffer(store: KeyValueStore, memory: MemoryClient, account: () => SocialAccount | null) {
  let open: string | null = null;
  let attempt = 0;
  return {
    // The question to ask at the start of this conversation, or null. Memory errors mean no offer this time.
    async prepare(): Promise<string | null> {
      const mine = ++attempt;
      open = null;
      const did = account()?.id;
      if (!did || (await store.get(SIGNED_OUT_MEMORIES).catch(() => null)) !== '1' || (await store.get(declinedKey(did)).catch(() => null))) return null;
      const saved = await memory.savedSignedOut().catch(() => null);
      if (saved && !saved.length) await store.remove(SIGNED_OUT_MEMORIES).catch(() => undefined);
      if (!saved?.length || mine !== attempt) return null;
      open = did;
      return offerQuestion(saved.length);
    },
    // The conversation started without asking (prepare was too slow): a late answer must not open the question.
    withdraw() {
      attempt++;
      open = null;
    },
    isOpen: () => open !== null && open === account()?.id,
    async accept() {
      const result = await memory.carryOver();
      open = null;
      if (!result.left) await store.remove(SIGNED_OUT_MEMORIES).catch(() => undefined);
      return result;
    },
    async decline() {
      if (open) await store.set(declinedKey(open), '1').catch(() => undefined);
      open = null;
    },
  };
}
