import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    provider: v.string(),
    providerUserId: v.string(),
    handle: v.string(),
    lastSeenAt: v.number(),
  }).index('by_provider_user', ['provider', 'providerUserId']),

  postDescriptions: defineTable({
    postUri: v.string(),
    description: v.string(),
    model: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_post_uri', ['postUri']),
});
