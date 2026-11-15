import { v } from 'convex/values';

import { takeOne, type RateCheck } from '../src/agent/memoryRateLimits';
import { internalMutation, type MutationCtx } from './_generated/server';

export const checksValidator = v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() }));

// Takes one call from every window in checks, or from none of them when any is used up. Run inside a mutation,
// so concurrent calls can't both take the last unit. The numbers are in src/agent/memoryRateLimits.ts.
export async function takeAll(ctx: MutationCtx, checks: RateCheck[]): Promise<boolean> {
  const now = Date.now();
  const updates = [];
  for (const check of checks) {
    const row = await ctx.db
      .query('memoryRateLimits')
      .withIndex('by_key', (q) => q.eq('key', check.key))
      .unique();
    const next = takeOne(row, check, now);
    if (!next) return false;
    updates.push({ row, key: check.key, next });
  }
  for (const { row, key, next } of updates) {
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert('memoryRateLimits', { key, ...next });
  }
  return true;
}

export const take = internalMutation({
  args: { checks: checksValidator },
  handler: async (ctx, { checks }) => takeAll(ctx, checks),
});
