import { v } from 'convex/values';

import { internalMutation, query } from './_generated/server';

export const getByUri = query({
  args: { postUri: v.string() },
  handler: async (ctx, { postUri }) => {
    const cached = await ctx.db
      .query('postDescriptions')
      .withIndex('by_post_uri', (q) => q.eq('postUri', postUri))
      .unique();
    return cached ? { description: cached.description, model: cached.model ?? null } : null;
  },
});

export const store = internalMutation({
  args: { postUri: v.string(), description: v.string(), model: v.optional(v.string()) },
  handler: async (ctx, { postUri, description, model }) => {
    const existing = await ctx.db
      .query('postDescriptions')
      .withIndex('by_post_uri', (q) => q.eq('postUri', postUri))
      .unique();
    if (existing) return ctx.db.patch(existing._id, { description, model, createdAt: Date.now() });
    await ctx.db.insert('postDescriptions', { postUri, description, model, createdAt: Date.now() });
  },
});
