import { v } from 'convex/values';

import { mutation } from './_generated/server';

export const upsert = mutation({
  args: { provider: v.string(), providerUserId: v.string(), handle: v.string() },
  handler: async (ctx, { provider, providerUserId, handle }) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_provider_user', (q) => q.eq('provider', provider).eq('providerUserId', providerUserId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { handle, lastSeenAt: Date.now() });
      return existing._id;
    }
    return ctx.db.insert('users', { provider, providerUserId, handle, lastSeenAt: Date.now() });
  },
});
