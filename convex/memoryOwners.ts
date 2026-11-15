import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import { checksValidator, takeAll } from './memoryLimits';

// Signed-out memory: the first device to use a device:<random id> key claims it with a secret it keeps in its
// keychain, and later calls must present the same secret. The id is random and never shown, so first come is
// safe here. Signed-in keys (bsky:<DID>) never come here: their DID is public, so they need a proof instead
// (convex/memoryAuth.ts). Then the key's own window is taken.
export const claim = internalMutation({
  args: { userKey: v.string(), secretHash: v.string(), checks: checksValidator },
  handler: async (ctx, { userKey, secretHash, checks }): Promise<'ok' | 'notOwner' | 'limited'> => {
    if (!userKey.startsWith('device:')) return 'notOwner';
    const owner = await ctx.db
      .query('memoryOwners')
      .withIndex('by_user_key', (q) => q.eq('userKey', userKey))
      .unique();
    if (owner && owner.secretHash !== secretHash) return 'notOwner';
    if (!owner) await ctx.db.insert('memoryOwners', { userKey, secretHash, createdAt: Date.now() });
    return (await takeAll(ctx, checks)) ? 'ok' : 'limited';
  },
});
