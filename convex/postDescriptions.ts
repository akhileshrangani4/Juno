import { v } from 'convex/values';

import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { decideClaim, LIMITS, windowStart, withinLimits } from './describeCache';
import { detailValidator, partsValidator } from './schema';

const key = { postUri: v.string(), promptVersion: v.number(), detail: detailValidator };
const GLOBAL = 'global';

export const get = internalQuery({
  args: key,
  handler: (ctx, { postUri, promptVersion, detail }) =>
    ctx.db
      .query('postDescriptions')
      .withIndex('by_post', (q) => q.eq('postUri', postUri).eq('promptVersion', promptVersion).eq('detail', detail))
      .unique(),
});

const usage = (ctx: MutationCtx, usageKey: string, start: number) =>
  ctx.db
    .query('describeUsage')
    .withIndex('by_key', (q) => q.eq('key', usageKey).eq('windowStart', start))
    .unique();

// Mutations run as serializable transactions, so two concurrent claims for the same key cannot both
// see "no row": one inserts the pending row and calls the model, the other sees it in flight and waits.
// The same transaction reserves the call's worst-case cost on the hourly counters (see LIMITS).
export const claim = internalMutation({
  args: { ...key, deviceHash: v.string() },
  handler: async (ctx, { postUri, promptVersion, detail, deviceHash }) => {
    const now = Date.now();
    const row = await ctx.db
      .query('postDescriptions')
      .withIndex('by_post', (q) => q.eq('postUri', postUri).eq('promptVersion', promptVersion).eq('detail', detail))
      .unique();
    const decision = decideClaim(row, now);
    if (decision.kind !== 'claim') return decision;

    const start = windowStart(now);
    const deviceKey = `device:${deviceHash}`;
    const [global, device] = await Promise.all([usage(ctx, GLOBAL, start), usage(ctx, deviceKey, start)]);
    if (!withinLimits(device, global)) return { kind: 'limited' as const };
    if (global) await ctx.db.patch(global._id, { calls: global.calls + 1, costUsd: global.costUsd + LIMITS.reserveUsd });
    else await ctx.db.insert('describeUsage', { key: GLOBAL, windowStart: start, calls: 1, costUsd: LIMITS.reserveUsd });
    if (device) await ctx.db.patch(device._id, { calls: device.calls + 1, costUsd: device.costUsd + LIMITS.reserveUsd });
    else await ctx.db.insert('describeUsage', { key: deviceKey, windowStart: start, calls: 1, costUsd: LIMITS.reserveUsd });
    const expired = await ctx.db
      .query('describeUsage')
      .withIndex('by_window', (q) => q.lt('windowStart', start))
      .take(LIMITS.pruneBatch);
    await Promise.all(expired.map((entry) => ctx.db.delete(entry._id)));

    const pending = { status: 'pending' as const, createdAt: now, updatedAt: now, error: undefined };
    if (row) await ctx.db.patch(row._id, pending);
    else await ctx.db.insert('postDescriptions', { postUri, promptVersion, detail, ...pending });
    return { kind: 'claim' as const, windowStart: start };
  },
});

export const complete = internalMutation({
  args: {
    ...key,
    windowStart: v.number(),
    parts: partsValidator,
    model: v.string(),
    latencyMs: v.number(),
    usage: v.object({
      inputTokens: v.number(),
      cachedTokens: v.number(),
      cacheWriteTokens: v.number(),
      outputTokens: v.number(),
      costUsd: v.union(v.number(), v.null()),
    }),
  },
  handler: async (ctx, { postUri, promptVersion, detail, windowStart: start, ...result }) => {
    const row = await ctx.db
      .query('postDescriptions')
      .withIndex('by_post', (q) => q.eq('postUri', postUri).eq('promptVersion', promptVersion).eq('detail', detail))
      .unique();
    if (row) await ctx.db.patch(row._id, { ...result, status: 'done', updatedAt: Date.now(), error: undefined });
    const global = await usage(ctx, GLOBAL, start);
    if (global && result.usage.costUsd !== null) await ctx.db.patch(global._id, { costUsd: global.costUsd - LIMITS.reserveUsd + result.usage.costUsd });
  },
});

export const fail = internalMutation({
  args: { ...key, error: v.string() },
  handler: async (ctx, { postUri, promptVersion, detail, error }) => {
    const row = await ctx.db
      .query('postDescriptions')
      .withIndex('by_post', (q) => q.eq('postUri', postUri).eq('promptVersion', promptVersion).eq('detail', detail))
      .unique();
    if (row) await ctx.db.patch(row._id, { status: 'failed', error: error.slice(0, 500), updatedAt: Date.now() });
  },
});
