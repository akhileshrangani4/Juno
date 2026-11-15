import { v } from 'convex/values';

import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { checksValidator, takeAll } from './memoryLimits';

// Storage for signed-in memory access (convex/memoryAuth.ts): the proofs already used, the sessions they opened,
// and the signing keys read from DID documents (or that a DID's document couldn't be had).

// Used proofs and sessions are kept until their token expires, then removed a few at a time as new ones arrive.
async function prune(ctx: MutationCtx, now: number) {
  for (const table of ['memoryProofs', 'memorySessions'] as const) {
    const expired = await ctx.db
      .query(table)
      .withIndex('by_expiry', (q) => q.lt('expiresAt', now))
      .take(20);
    for (const row of expired) await ctx.db.delete(row._id);
  }
}

async function liveSession(ctx: MutationCtx, did: string, sessionHash: string, now: number) {
  const session = await ctx.db
    .query('memorySessions')
    .withIndex('by_hash', (q) => q.eq('sessionHash', sessionHash))
    .unique();
  return session && session.did === did && session.expiresAt > now ? session : null;
}

export const useSession = internalMutation({
  args: { did: v.string(), sessionHash: v.string(), checks: checksValidator },
  handler: async (ctx, { did, sessionHash, checks }): Promise<'ok' | 'unknown' | 'limited'> => {
    if (!(await liveSession(ctx, did, sessionHash, Date.now()))) return 'unknown';
    return (await takeAll(ctx, checks)) ? 'ok' : 'limited';
  },
});

// One proof opens one session. Presented again, it is refused, unless it comes with the session it already
// opened: that is the same phone sending two calls at once.
export const openSession = internalMutation({
  args: { proofId: v.string(), did: v.string(), sessionHash: v.string(), expiresAt: v.number(), checks: checksValidator },
  handler: async (ctx, { proofId, did, sessionHash, expiresAt, checks }): Promise<'ok' | 'replayed' | 'limited'> => {
    const now = Date.now();
    await prune(ctx, now);
    const used = await ctx.db
      .query('memoryProofs')
      .withIndex('by_proof', (q) => q.eq('proofId', proofId))
      .unique();
    if (used) {
      if (used.sessionHash !== sessionHash || !(await liveSession(ctx, did, sessionHash, now))) return 'replayed';
    } else {
      await ctx.db.insert('memoryProofs', { proofId, sessionHash, expiresAt });
      await ctx.db.insert('memorySessions', { sessionHash, did, expiresAt });
    }
    return (await takeAll(ctx, checks)) ? 'ok' : 'limited';
  },
});

export const cachedKey = internalQuery({
  args: { did: v.string() },
  handler: async (ctx, { did }) => {
    const row = await ctx.db
      .query('didKeys')
      .withIndex('by_did', (q) => q.eq('did', did))
      .unique();
    if (!row) return null;
    return { key: row.curve && row.publicKey ? { curve: row.curve, publicKey: row.publicKey } : null, fetchedAt: row.fetchedAt };
  },
});

// A fetched key (or the one verified before, when the fetch found none), or null when there is no key at all;
// either way the fetch time.
export const storeKey = internalMutation({
  args: { did: v.string(), key: v.union(v.null(), v.object({ curve: v.union(v.literal('p256'), v.literal('k256')), publicKey: v.string() })) },
  handler: async (ctx, { did, key }) => {
    const row = await ctx.db
      .query('didKeys')
      .withIndex('by_did', (q) => q.eq('did', did))
      .unique();
    const fields = { curve: key?.curve, publicKey: key?.publicKey, fetchedAt: Date.now() };
    if (row) await ctx.db.replace(row._id, { did, ...fields });
    else await ctx.db.insert('didKeys', { did, ...fields });
  },
});

// One-off, after this change is deployed: signed-in keys used to be claimed by the first device secret, so a
// stranger could have claimed someone's DID. Those claims are no longer read; this deletes them. Returns how many.
// npx convex run memoryAccess:clearAccountClaims
export const clearAccountClaims = internalMutation({
  args: {},
  handler: async (ctx) => {
    const claims = (await ctx.db.query('memoryOwners').collect()).filter((owner) => !owner.userKey.startsWith('device:'));
    for (const claim of claims) await ctx.db.delete(claim._id);
    return claims.length;
  },
});
