import { createRateLimiter } from '../rateLimit';

describe('createRateLimiter', () => {
  it('allows one call per interval', () => {
    let time = 0;
    const allow = createRateLimiter(2500, () => time);
    expect(allow()).toBe(true);
    time = 1000;
    expect(allow()).toBe(false);
    time = 2499;
    expect(allow()).toBe(false);
    time = 2500;
    expect(allow()).toBe(true);
  });
});
