import { v } from 'convex/values';

import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';
import { LIMITS, windowStart } from './describeCache';
import { planReserve, settledSpend } from './lookLimits';

// The camera's hourly spend lives in describeUsage under its own key, beside describe.ts's "global" row. The
// call-count windows live in memoryRateLimits under keys that start with "look:" (see lookLimits.ts).
const SPEND_KEY = 'look:global';

const spend = (ctx: MutationCtx, start: number) =>
  ctx.db
    .query('describeUsage')
    .withIndex('by_key', (q) => q.eq('key', SPEND_KEY).eq('windowStart', start))
    .unique();

// Mutations run as serializable transactions, so two concurrent calls cannot both take the last unit of a
// window or the last of the budget. Either every window and the reservation are taken, or nothing is.
export const reserve = internalMutation({
  args: { checks: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })), reserveUsd: v.number() },
  handler: async (ctx, { checks, reserveUsd }) => {
    const now = Date.now();
    const start = windowStart(now);
    const rows = await Promise.all(
      checks.map((check) =>
        ctx.db
          .query('memoryRateLimits')
          .withIndex('by_key', (q) => q.eq('key', check.key))
          .unique(),
      ),
    );
    const counter = await spend(ctx, start);
    const plan = planReserve(rows, checks, counter?.costUsd ?? 0, reserveUsd, now);
    if (plan.refused) return { ok: false as const, refused: plan.refused };
    await Promise.all(
      plan.buckets.map((bucket, i) => {
        const row = rows[i];
        return row ? ctx.db.patch(row._id, bucket) : ctx.db.insert('memoryRateLimits', { key: checks[i].key, ...bucket });
      }),
    );
    if (counter) await ctx.db.patch(counter._id, { calls: counter.calls + 1, costUsd: plan.spentUsd });
    else await ctx.db.insert('describeUsage', { key: SPEND_KEY, windowStart: start, calls: 1, costUsd: plan.spentUsd });
    const expired = await ctx.db
      .query('describeUsage')
      .withIndex('by_window', (q) => q.lt('windowStart', start))
      .take(LIMITS.pruneBatch);
    await Promise.all(expired.map((entry) => ctx.db.delete(entry._id)));
    return { ok: true as const, windowStart: start };
  },
});

// Swaps the reservation for the cost the response reported, or releases it when nothing was reported. A call
// that started in an hour whose row has since been pruned has nothing left to settle.
export const settle = internalMutation({
  args: { windowStart: v.number(), reserveUsd: v.number(), costUsd: v.union(v.number(), v.null()) },
  handler: async (ctx, { windowStart: start, reserveUsd, costUsd }) => {
    const counter = await spend(ctx, start);
    if (counter) await ctx.db.patch(counter._id, { costUsd: settledSpend(counter.costUsd, reserveUsd, costUsd) });
  },
});
