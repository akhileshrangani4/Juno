// Rate limits on the public memory actions in convex/memory.ts, so someone who knows the deployment URL can't
// run up the Supermemory bill. Each call takes one unit from three fixed windows, and is refused when any of them
// is used up. The address and deployment windows are taken first, before any verification work; the user's window
// only after the device's secret or the account's proof checks out (convex/memoryAuth.ts), so a stranger who
// knows someone's public DID can't use up that person's allowance:
// - per user (the memory key, bsky:<DID> or device:<id>): 30 calls per 10 minutes. A 10-minute conversation
//   uses about one list plus a few remember or forget calls.
// - per caller address (the request's IP, stored only as a hash): 60 calls per 10 minutes, so making up new
//   memory keys from one place doesn't get around the device limit.
// - for the whole deployment: 600 calls per hour, a ceiling on spend however many addresses are used.
// - DID document fetches for the whole deployment: 120 per hour, taken just before a fetch that the key cache
//   couldn't answer, so proofs can't make this deployment fetch documents at any rate.
// remember also refuses once a person has MAX_FACTS facts.
// Known limit: whoever uses up the deployment window turns memory off for everyone until the hour is over.
// Pure logic, shared with the Convex side so it can be unit tested here.

export const MAX_FACTS = 50;

const TEN_MINUTES = 10 * 60_000;

export const MEMORY_LIMITS = {
  user: { limit: 30, windowMs: TEN_MINUTES },
  address: { limit: 60, windowMs: TEN_MINUTES },
  deployment: { limit: 600, windowMs: 60 * 60_000 },
  didFetch: { limit: 120, windowMs: 60 * 60_000 },
} as const;

export type RateCheck = { key: string; limit: number; windowMs: number };
export type Bucket = { windowStart: number; count: number };

// Taken first, before the owner check or the proof.
export function callerChecks(addressHash: string | null): RateCheck[] {
  return [...(addressHash ? [{ key: `address:${addressHash}`, ...MEMORY_LIMITS.address }] : []), { key: 'deployment', ...MEMORY_LIMITS.deployment }];
}

// Taken after the owner check or the proof.
export function userCheck(userKey: string): RateCheck[] {
  return [{ key: `user:${userKey}`, ...MEMORY_LIMITS.user }];
}

// Taken just before a DID document is fetched.
export function didFetchCheck(): RateCheck[] {
  return [{ key: 'didFetch', ...MEMORY_LIMITS.didFetch }];
}

// The bucket after one more call, or null when the call is over the limit.
export function takeOne(bucket: Bucket | null, check: RateCheck, now: number): Bucket | null {
  if (!bucket || now - bucket.windowStart >= check.windowMs) return { windowStart: now, count: 1 };
  if (bucket.count >= check.limit) return null;
  return { windowStart: bucket.windowStart, count: bucket.count + 1 };
}
