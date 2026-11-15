import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const detailValidator = v.union(v.literal('standard'), v.literal('detailed'));

export const partsValidator = v.object({
  images: v.array(v.object({ description: v.string(), beyondAlt: v.string() })),
  video: v.union(v.string(), v.null()),
  hashtagTopic: v.union(v.string(), v.null()),
});

export default defineSchema({
  users: defineTable({
    provider: v.string(),
    providerUserId: v.string(),
    handle: v.string(),
    lastSeenAt: v.number(),
  }).index('by_provider_user', ['provider', 'providerUserId']),

  postDescriptions: defineTable({
    postUri: v.string(),
    promptVersion: v.number(),
    detail: detailValidator,
    status: v.union(v.literal('pending'), v.literal('done'), v.literal('failed')),
    parts: v.optional(partsValidator),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    latencyMs: v.optional(v.number()),
    usage: v.optional(
      v.object({
        inputTokens: v.number(),
        cachedTokens: v.number(),
        cacheWriteTokens: v.number(),
        outputTokens: v.number(),
        costUsd: v.union(v.number(), v.null()),
      }),
    ),
    // What a pending claim holds on that hour's spend counter, until the call completes, fails or expires.
    reservation: v.optional(v.object({ windowStart: v.number(), usd: v.number() })),
  })
    .index('by_post', ['postUri', 'promptVersion', 'detail'])
    .index('by_status_updated', ['status', 'updatedAt']),
  // Hourly counters for describe:describePost: model spend for the whole deployment ("global") and model calls
  // per hashed device id, plus Bluesky fetches ("fetch:…") per deployment, hashed address and hashed device.
  // Rows from past hours are deleted as new requests arrive.
  describeUsage: defineTable({
    key: v.string(),
    windowStart: v.number(),
    calls: v.number(),
    costUsd: v.number(),
  })
    .index('by_key', ['key', 'windowStart'])
    .index('by_window', ['windowStart']),

  memoryOwners: defineTable({
    userKey: v.string(),
    secretHash: v.string(),
    createdAt: v.number(),
  }).index('by_user_key', ['userKey']),

  memoryRateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
});
