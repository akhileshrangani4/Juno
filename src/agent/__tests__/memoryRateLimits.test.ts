import { callerChecks, deviceCheck, MEMORY_LIMITS, takeOne, type Bucket, type RateCheck } from '../memoryRateLimits';

// The same take-all-or-nothing rule as convex/memoryLimits.ts, in the order convex/memory.ts uses: the caller's
// windows, then the owner check, then the device window.
function memory(owners: Map<string, string>) {
  const buckets = new Map<string, Bucket>();
  const take = (checks: RateCheck[], now: number) => {
    const next = checks.map((check) => takeOne(buckets.get(check.key) ?? null, check, now));
    if (next.some((bucket) => !bucket)) return false;
    checks.forEach((check, i) => buckets.set(check.key, next[i]!));
    return true;
  };
  return (userKey: string, secret: string, address: string | null, now = 1000): 'ok' | 'tooMany' | 'notOwner' => {
    if (!take(callerChecks(address), now)) return 'tooMany';
    if (!owners.has(userKey)) owners.set(userKey, secret);
    if (owners.get(userKey) !== secret) return 'notOwner';
    return take(deviceCheck(userKey), now) ? 'ok' : 'tooMany';
  };
}

describe('memory rate limits', () => {
  it('allows 30 calls per device in 10 minutes, then refuses until the window passes', () => {
    const call = memory(new Map());
    for (let i = 0; i < MEMORY_LIMITS.device.limit; i++) expect(call('device:a', 'secret-a', `hash-${i}`, 1000 + i)).toBe('ok');
    expect(call('device:a', 'secret-a', 'hash-x', 2000)).toBe('tooMany');
    expect(call('device:a', 'secret-a', 'hash-x', 1000 + MEMORY_LIMITS.device.windowMs)).toBe('ok');
  });

  it("doesn't let a stranger who knows a public DID use up that person's allowance", () => {
    const call = memory(new Map([['bsky:did:plc:me', 'my-secret']]));
    for (let i = 0; i < 200; i++) expect(call('bsky:did:plc:me', 'wrong-secret', `hash-stranger-${i}`)).toBe('notOwner');
    expect(call('bsky:did:plc:me', 'my-secret', 'hash-me')).toBe('ok');
  });

  it('limits one caller address to 60 calls in 10 minutes even with fresh device keys', () => {
    const call = memory(new Map());
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (call(`device:fresh-${i}`, 'secret', 'hash-attacker') === 'ok') allowed++;
    expect(allowed).toBe(MEMORY_LIMITS.address.limit);
    expect(call('device:someone-else', 'secret', 'hash-other')).toBe('ok');
  });

  it('caps the whole deployment at 600 calls an hour however many addresses are used', () => {
    const call = memory(new Map());
    let allowed = 0;
    for (let i = 0; i < 700; i++) if (call(`device:${i}`, 'secret', `hash-${i}`) === 'ok') allowed++;
    expect(allowed).toBe(MEMORY_LIMITS.deployment.limit);
  });

  it('skips the address window when the request has no address', () => {
    expect(callerChecks(null).map((check) => check.key)).toEqual(['deployment']);
    expect(deviceCheck('device:a').map((check) => check.key)).toEqual(['device:device:a']);
  });
});
