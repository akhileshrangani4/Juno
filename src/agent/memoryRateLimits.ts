// Rate limits on the public memory actions in convex/memory.ts, so someone who knows the deployment URL can't
// run up the Supermemory bill. Each call takes one unit from three fixed windows at once, and is refused when
// any of them is used up:
// - per device (the memory key, bsky:<DID> or device:<id>): 30 calls per 10 minutes. A 10-minute conversation
//   uses about one list plus a few remember or forget calls.
// - per caller address (the request's IP, stored only as a hash): 60 calls per 10 minutes, so making up new
//   memory keys from one place doesn't get around the device limit.
// - for the whole deployment: 600 calls per hour, a ceiling on spend however many addresses are used.
// remember also refuses once a person has MAX_FACTS facts.
// Pure logic, shared with the Convex side so it can be unit tested here.

export const MAX_FACTS = 50;

const TEN_MINUTES = 10 * 60_000;

export const MEMORY_LIMITS = {
  device: { limit: 30, windowMs: TEN_MINUTES },
  address: { limit: 60, windowMs: TEN_MINUTES },
  deployment: { limit: 600, windowMs: 60 * 60_000 },
} as const;

export type RateCheck = { key: string; limit: number; windowMs: number };
export type Bucket = { windowStart: number; count: number };

export function memoryChecks(userKey: string, addressHash: string | null): RateCheck[] {
  return [
    { key: `device:${userKey}`, ...MEMORY_LIMITS.device },
    ...(addressHash ? [{ key: `address:${addressHash}`, ...MEMORY_LIMITS.address }] : []),
    { key: 'deployment', ...MEMORY_LIMITS.deployment },
  ];
}

// The bucket after one more call, or null when the call is over the limit.
export function takeOne(bucket: Bucket | null, check: RateCheck, now: number): Bucket | null {
  if (!bucket || now - bucket.windowStart >= check.windowMs) return { windowStart: now, count: 1 };
  if (bucket.count >= check.limit) return null;
  return { windowStart: bucket.windowStart, count: bucket.count + 1 };
}
