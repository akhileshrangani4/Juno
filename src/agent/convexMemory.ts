import { ConvexError } from 'convex/values';

import { convex } from '@/backend/convex';
import type { KeyValueStore } from '@/storage/keyValueStore';

import { api } from '../../convex/_generated/api';
import type { MemoryErrorCode } from '../../convex/memoryAuth';
import { convexSiteUrl, memoryAudience } from '../../convex/memoryService';
import { SIGNED_OUT_MEMORIES } from './memoryOffer';
import type { MemoryAccess, MemoryAccessSource } from './memoryAccess';
import { MemoryUnavailableError, type Memory, type MemoryClient } from './memoryClient';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;

export const convexMemoryAudience = url ? memoryAudience(convexSiteUrl(url)) : null;

type Action = <T>(name: 'list' | 'remember' | 'forget' | 'carryOver', args: Record<string, unknown>) => Promise<T>;

const MESSAGES: Partial<Record<MemoryErrorCode, string>> = {
  tooMany: 'Too many memory requests. Try again in a few minutes.',
  notOwner: 'This memory belongs to another device',
  invalid: 'Invalid memory identity',
};

function codeOf(error: unknown): MemoryErrorCode | null {
  return error instanceof ConvexError && typeof error.data?.code === 'string' ? (error.data.code as MemoryErrorCode) : null;
}

// Convex hides server error messages in production, so the codes become the words the agent hears here, and a
// proof that is missing or refused means memory can't be reached on this call.
function plain(error: unknown): unknown {
  const code = codeOf(error);
  if (code === 'proofNeeded' || code === 'proofRefused') return new MemoryUnavailableError(`Memory proof ${code}`, { cause: error });
  return code && MESSAGES[code] ? new Error(MESSAGES[code]) : error;
}

export function createMemoryClient(action: Action, access: MemoryAccessSource, store: KeyValueStore): MemoryClient {
  // A session the server no longer knows (it expired early, or the first call that carried its proof failed)
  // gets one new proof.
  async function call<T>(name: 'list' | 'remember' | 'forget', args: Record<string, unknown>, from?: MemoryAccess): Promise<T> {
    const first = from ?? (await access.current());
    try {
      return await action<T>(name, { ...args, access: first });
    } catch (error) {
      if (codeOf(error) !== 'proofNeeded' || first.kind !== 'account') throw plain(error);
    }
    try {
      return await action<T>(name, { ...args, access: await access.renew() });
    } catch (error) {
      throw plain(error);
    }
  }

  return {
    list: () => call<Memory[]>('list', {}),
    async remember(fact) {
      const from = await access.current();
      const memory = await call<Memory>('remember', { fact }, from);
      if (from.kind === 'device') await store.set(SIGNED_OUT_MEMORIES, '1').catch(() => undefined);
      return memory;
    },
    forget: (ids) => call<Memory[]>('forget', { ids }),
    savedSignedOut: async () => call<Memory[]>('list', {}, await access.device()),
    async carryOver() {
      const [from, to] = await Promise.all([access.device(), access.account()]);
      try {
        return await action<{ carried: number; left: number }>('carryOver', { from, to });
      } catch (error) {
        if (codeOf(error) !== 'proofNeeded') throw plain(error);
      }
      try {
        return await action<{ carried: number; left: number }>('carryOver', { from, to: await access.renew() });
      } catch (error) {
        throw plain(error);
      }
    },
  };
}

export function createConvexMemory(access: MemoryAccessSource, store: KeyValueStore): MemoryClient | null {
  const client = convex;
  if (!client) return null;
  const action: Action = (name, args) => client.action(api.memory[name], args as never) as never;
  return createMemoryClient(action, access, store);
}
