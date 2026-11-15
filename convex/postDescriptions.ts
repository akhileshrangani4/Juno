import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { decideClaim, fetchChecks, LIMITS, settleReservation, windowStart, withinLimits } from './describeCache';
import { detailValidator, partsValidator } from './schema';

const key = { postUri: v.string(), promptVersion: v.number(), detail: detailValidator };
type Key = { postUri: string; promptVersion: number; detail: Doc<'postDescriptions'>['detail'] };
const GLOBAL = 'global';

const row = (ctx: MutationCtx, { postUri, promptVersion, detail }: Key) =>
  ctx.db
    .query('postDescriptions')
    .withIndex('by_post', (q) => q.eq('postUri', postUri).eq('promptVersion', promptVersion).eq('detail', detail))
    .unique();

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

async function bump(ctx: MutationCtx, usageKey: string, start: number, costUsd: number) {
  const current = await usage(ctx, usageKey, start);
  if (current) await ctx.db.patch(current._id, { calls: current.calls + 1, costUsd: current.costUsd + costUsd });
  else await ctx.db.insert('describeUsage', { key: usageKey, windowStart: start, calls: 1, costUsd });
}

// Gives a claim's reservation back to the hour it was taken from, or swaps it for what the call really cost.
async function settle(ctx: MutationCtx, reservation: Doc<'postDescriptions'>['reservation'], actualUsd: number | null) {
  if (!reservation) return;
  const global = await usage(ctx, GLOBAL, reservation.windowStart);
  if (global) await ctx.db.patch(global._id, { costUsd: settleReservation(global.costUsd, reservation.usd, actualUsd) });
}

async function prune(ctx: MutationCtx, now: number) {
  const [counters, failures] = await Promise.all([
    ctx.db
      .query('describeUsage')
      .withIndex('by_window', (q) => q.lt('windowStart', windowStart(now)))
      .take(LIMITS.pruneBatch),
    ctx.db
      .query('postDescriptions')
      .withIndex('by_status_updated', (q) => q.eq('status', 'failed').lt('updatedAt', now - LIMITS.pruneAfterMs))
      .take(LIMITS.pruneBatch),
  ]);
  await Promise.all([...counters, ...failures].map((entry) => ctx.db.delete(entry._id)));
}

// Taken before the action fetches anything from Bluesky: one fetch from the deployment's, the caller
// address's and the device's hourly allowance, or from none of them when any is used up (see FETCH_LIMITS).
export const admit = internalMutation({
  args: { deviceHash: v.string(), addressHash: v.union(v.string(), v.null()) },
  handler: async (ctx, { deviceHash, addressHash }) => {
    const now = Date.now();
    const start = windowStart(now);
    const checks = fetchChecks(deviceHash, addressHash);
    const counters = await Promise.all(checks.map((check) => usage(ctx, check.key, start)));
    if (checks.some((check, i) => (counters[i]?.calls ?? 0) >= check.limit)) return false;
    await Promise.all(checks.map((check) => bump(ctx, check.key, start, 0)));
    await prune(ctx, now);
    return true;
  },
});

// Remembers for a while that a URI has nothing to describe (it does not resolve, or the post has no media),
// so asking again does not fetch it again. Never overwrites a description.
export const miss = internalMutation({
  args: { ...key, reason: v.string() },
  handler: async (ctx, { reason, ...postKey }) => {
    const now = Date.now();
    const existing = await row(ctx, postKey);
    const failed = { status: 'failed' as const, error: reason, updatedAt: now };
    if (!existing) await ctx.db.insert('postDescriptions', { ...postKey, ...failed, createdAt: now });
    else if (existing.status !== 'done' && existing.status !== 'pending') await ctx.db.patch(existing._id, failed);
  },
});

// Mutations run as serializable transactions, so two concurrent claims for the same key cannot both
// see "no row": one inserts the pending row and calls the model, the other sees it in flight and waits.
// The same transaction reserves the call's worst-case cost on the hourly counters (see LIMITS), records the
// reservation on the row, and schedules its expiry in case the action never reports back.
export const claim = internalMutation({
  args: { ...key, deviceHash: v.string() },
  handler: async (ctx, { deviceHash, ...postKey }) => {
    const now = Date.now();
    const existing = await row(ctx, postKey);
    const decision = decideClaim(existing, now);
    if (decision.kind !== 'claim') return decision;

    const start = windowStart(now);
    const deviceKey = `device:${deviceHash}`;
    if (existing?.status === 'pending') await settle(ctx, existing.reservation, 0);
    const [global, device] = await Promise.all([usage(ctx, GLOBAL, start), usage(ctx, deviceKey, start)]);
    if (!withinLimits(device, global)) return { kind: 'limited' as const };
    await bump(ctx, GLOBAL, start, LIMITS.reserveUsd);
    await bump(ctx, deviceKey, start, 0);
    await prune(ctx, now);

    const pending = { status: 'pending' as const, createdAt: now, updatedAt: now, error: undefined, reservation: { windowStart: start, usd: LIMITS.reserveUsd } };
    if (existing) await ctx.db.patch(existing._id, pending);
    else await ctx.db.insert('postDescriptions', { ...postKey, ...pending });
    await ctx.scheduler.runAfter(LIMITS.expireMs, internal.postDescriptions.expire, { ...postKey, claimedAt: now });
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
  handler: async (ctx, { windowStart: start, ...result }) => {
    const { postUri, promptVersion, detail, ...done } = result;
    const existing = await row(ctx, { postUri, promptVersion, detail });
    if (!existing) return;
    const actualUsd = done.usage.costUsd ?? LIMITS.reserveUsd;
    const held = existing.status === 'pending' ? existing.reservation : undefined;
    await settle(ctx, held ?? { windowStart: start, usd: 0 }, actualUsd);
    await ctx.db.patch(existing._id, { ...done, status: 'done', updatedAt: Date.now(), error: undefined, reservation: undefined });
  },
});

// A failed or timed-out model call gives its reservation back: nothing was billed, or nothing was reported.
export const fail = internalMutation({
  args: { ...key, error: v.string() },
  handler: async (ctx, { error, ...postKey }) => {
    const existing = await row(ctx, postKey);
    if (!existing) return;
    if (existing.status === 'pending') await settle(ctx, existing.reservation, 0);
    await ctx.db.patch(existing._id, { status: 'failed', error: error.slice(0, 500), updatedAt: Date.now(), reservation: undefined });
  },
});

// Scheduled by every claim. If the action never reported back, the claim is failed and its reservation given back.
export const expire = internalMutation({
  args: { ...key, claimedAt: v.number() },
  handler: async (ctx, { claimedAt, ...postKey }) => {
    const existing = await row(ctx, postKey);
    if (!existing || existing.status !== 'pending' || existing.createdAt !== claimedAt) return;
    await settle(ctx, existing.reservation, 0);
    await ctx.db.patch(existing._id, { status: 'failed', error: 'the action never reported back', updatedAt: Date.now(), reservation: undefined });
  },
});
