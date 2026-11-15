import { convex } from '@/backend/convex';

import { api } from '../../convex/_generated/api';
import type { MemoryClient } from './memoryClient';

type Identity = { userKey: string; secret: string };

export function createConvexMemory(identity: () => Promise<Identity>): MemoryClient | null {
  const client = convex;
  if (!client) return null;
  return {
    list: async () => client.action(api.memory.list, await identity()),
    remember: async (fact) => client.action(api.memory.remember, { ...(await identity()), fact }),
    forget: async (ids) => client.action(api.memory.forget, { ...(await identity()), ids }),
  };
}
