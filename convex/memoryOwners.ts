import { v } from 'convex/values';

import { internalMutation } from './_generated/server';

// The first device to use a memory key claims it with a secret it keeps in its keychain. Later calls must
// present the same secret, so knowing someone's Bluesky DID is not enough to read their memories.
// Known gap, tracked in AKH-18: first come claims a bsky:<DID> key, so someone else can claim a DID first, and a
// signed-in user's second device is refused. The fix is proof of the DID instead of first come.
export const verify = internalMutation({
  args: { userKey: v.string(), secretHash: v.string() },
  handler: async (ctx, { userKey, secretHash }) => {
    const owner = await ctx.db
      .query('memoryOwners')
      .withIndex('by_user_key', (q) => q.eq('userKey', userKey))
      .unique();
    if (!owner) {
      await ctx.db.insert('memoryOwners', { userKey, secretHash, createdAt: Date.now() });
      return true;
    }
    return owner.secretHash === secretHash;
  },
});
