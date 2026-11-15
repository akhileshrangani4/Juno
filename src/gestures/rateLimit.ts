export function createRateLimiter(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity;
  return () => {
    const time = now();
    if (time - last < intervalMs) return false;
    last = time;
    return true;
  };
}
