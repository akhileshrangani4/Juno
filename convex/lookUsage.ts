import { v } from 'convex/values';

import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';
import { LIMITS, windowStart } from './describeCache';
import { planReserve, settledSpend } from './lookLimits';

// The camera's hourly spend lives in describeUsage beside describe.ts's "global" row: the whole deployment's
// under "look:global" and each caller address's under "look:address:<digest>" (see lookSpends in
// lookLimits.ts). The call-count windows live in memoryRateLimits under keys that start with "look:".
const spend = (ctx: MutationCtx, key: string, start: number) =>
  ctx.db
    .query('describeUsage')
    .withIndex('by_key', (q) => q.eq('key', key).eq('windowStart', start))
    .unique();

// Mutations run as serializable transactions, so two concurrent calls cannot both take the last unit of a
// window or the last of a budget. Either every window and every reservation are taken, or nothing is.
export const reserve = internalMutation({
  args: {
    checks: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })),
    spends: v.array(v.object({ key: v.string(), limitUsd: v.number() })),
    reserveUsd: v.number(),
  },
  handler: async (ctx, { checks, spends, reserveUsd }) => {
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
    const counters = await Promise.all(spends.map((entry) => spend(ctx, entry.key, start)));
    const plan = planReserve(rows, checks, spends, counters.map((counter) => counter?.costUsd ?? 0), reserveUsd, now);
    if (plan.refused) return { ok: false as const, refused: plan.refused };
    await Promise.all(
      plan.buckets.map((bucket, i) => {
        const row = rows[i];
        return row ? ctx.db.patch(row._id, bucket) : ctx.db.insert('memoryRateLimits', { key: checks[i].key, ...bucket });
      }),
    );
    await Promise.all(
      counters.map((counter, i) =>
        counter
          ? ctx.db.patch(counter._id, { calls: counter.calls + 1, costUsd: plan.spentUsd[i] })
          : ctx.db.insert('describeUsage', { key: spends[i].key, windowStart: start, calls: 1, costUsd: plan.spentUsd[i] }),
      ),
    );
    const expired = await ctx.db
      .query('describeUsage')
      .withIndex('by_window', (q) => q.lt('windowStart', start))
      .take(LIMITS.pruneBatch);
    await Promise.all(expired.map((entry) => ctx.db.delete(entry._id)));
    return { ok: true as const, windowStart: start, spendKeys: spends.map((entry) => entry.key) };
  },
});

// Swaps the reservation for the cost the response reported, or releases it when nothing was reported, on
// every counter the call reserved against. A call that started in an hour whose rows have since been pruned
// has nothing left to settle.
export const settle = internalMutation({
  args: { windowStart: v.number(), spendKeys: v.array(v.string()), reserveUsd: v.number(), costUsd: v.union(v.number(), v.null()) },
  handler: async (ctx, { windowStart: start, spendKeys, reserveUsd, costUsd }) => {
    const counters = await Promise.all(spendKeys.map((key) => spend(ctx, key, start)));
    await Promise.all(counters.map((counter) => counter && ctx.db.patch(counter._id, { costUsd: settledSpend(counter.costUsd, reserveUsd, costUsd) })));
  },
});
