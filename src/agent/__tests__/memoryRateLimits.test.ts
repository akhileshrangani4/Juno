import { MEMORY_LIMITS, memoryChecks, takeOne, type Bucket, type RateCheck } from '../memoryRateLimits';

// Runs calls through the same take-all-or-nothing rule as convex/memoryLimits.ts.
function limiter() {
  const buckets = new Map<string, Bucket>();
  return (checks: RateCheck[], now: number) => {
    const next = checks.map((check) => takeOne(buckets.get(check.key) ?? null, check, now));
    if (next.some((bucket) => !bucket)) return false;
    checks.forEach((check, i) => buckets.set(check.key, next[i]!));
    return true;
  };
}

describe('memory rate limits', () => {
  it('allows 30 calls per device in 10 minutes, then refuses until the window passes', () => {
    const take = limiter();
    const checks = memoryChecks('device:a', 'hash-1');
    for (let i = 0; i < MEMORY_LIMITS.device.limit; i++) expect(take(checks, 1000 + i)).toBe(true);
    expect(take(checks, 2000)).toBe(false);
    expect(take(checks, 1000 + MEMORY_LIMITS.device.windowMs)).toBe(true);
  });

  it('limits one caller address to 60 calls in 10 minutes even with fresh device keys', () => {
    const take = limiter();
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (take(memoryChecks(`device:fresh-${i}`, 'hash-attacker'), 1000)) allowed++;
    expect(allowed).toBe(MEMORY_LIMITS.address.limit);
    expect(take(memoryChecks('device:someone-else', 'hash-other'), 1000)).toBe(true);
  });

  it('caps the whole deployment at 600 calls an hour however many addresses are used', () => {
    const take = limiter();
    let allowed = 0;
    for (let i = 0; i < 700; i++) if (take(memoryChecks(`device:${i}`, `hash-${i}`), 1000)) allowed++;
    expect(allowed).toBe(MEMORY_LIMITS.deployment.limit);
  });

  it('takes nothing from any window when one refuses', () => {
    const take = limiter();
    const busy = memoryChecks('device:busy', 'hash-1');
    for (let i = 0; i < MEMORY_LIMITS.device.limit; i++) take(busy, 1000);
    for (let i = 0; i < 10; i++) expect(take(busy, 1000)).toBe(false);
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (take(memoryChecks(`device:other-${i}`, 'hash-1'), 1000)) allowed++;
    expect(allowed).toBe(MEMORY_LIMITS.address.limit - MEMORY_LIMITS.device.limit);
  });

  it('skips the address check when the request has no address', () => {
    expect(memoryChecks('device:a', null).map((check) => check.key)).toEqual(['device:device:a', 'deployment']);
  });
});
