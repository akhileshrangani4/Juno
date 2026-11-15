import type { SocialAccount } from '@/social/types';
import type { KeyValueStore } from '@/storage/keyValueStore';

import type { MemoryClient } from './memoryClient';

// Someone who used Juno signed out has memories under this phone's own key. After they sign in, the agent's first
// words ask whether to keep them with the account, and they move only on a plain yes in the user's very next turn
// (toolHandlers.ts, answer_memory_offer), the same rule as a publish confirmation. Any other turn closes the
// question; the user can ask for it again by name (ask_to_keep_saved_memories), which asks it again. A no keeps
// them on the phone for signed-out use, and the question isn't asked at the start again for that account.

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
  // The account the question was asked for, and the conversation turn it was asked in.
  let open: { did: string; turn: number } | null = null;
  let attempt = 0;

  async function saved(did: string | undefined): Promise<number> {
    if (!did) return 0;
    const memories = await memory.savedSignedOut().catch(() => null);
    if (memories && !memories.length) await store.remove(SIGNED_OUT_MEMORIES).catch(() => undefined);
    return memories?.length ?? 0;
  }

  return {
    // The question to ask at the start of this conversation, or null. Memory errors mean no offer this time.
    async prepare(): Promise<string | null> {
      const mine = ++attempt;
      open = null;
      const did = account()?.id;
      if (!did || (await store.get(SIGNED_OUT_MEMORIES).catch(() => null)) !== '1' || (await store.get(declinedKey(did)).catch(() => null))) return null;
      const count = await saved(did);
      if (!count || mine !== attempt) return null;
      open = { did, turn: 0 };
      return offerQuestion(count);
    },
    // The user asked for it by name in this turn: the question again, or null when nothing is saved.
    async ask(turn: number): Promise<string | null> {
      attempt++;
      const did = account()?.id;
      const count = await saved(did);
      open = count && did ? { did, turn } : null;
      return open ? offerQuestion(count) : null;
    },
    // The conversation started without asking (prepare was too slow): a late answer must not open the question.
    withdraw() {
      attempt++;
      open = null;
    },
    // Open only for the user's turn right after the question, and for the account it was asked for.
    isOpen: (turn: number) => open !== null && open.did === account()?.id && turn === open.turn + 1,
    async accept() {
      const result = await memory.carryOver();
      open = null;
      if (!result.left) await store.remove(SIGNED_OUT_MEMORIES).catch(() => undefined);
      return result;
    },
    async decline() {
      if (open) await store.set(declinedKey(open.did), '1').catch(() => undefined);
      open = null;
    },
  };
}
