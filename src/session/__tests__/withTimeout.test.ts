import { withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('session'), 1000, null)).resolves.toBe('session');
  });

  it('resolves with the fallback when the promise is too slow', async () => {
    const result = withTimeout(new Promise(() => undefined), 4000, null);
    jest.advanceTimersByTime(4000);
    await expect(result).resolves.toBeNull();
  });
});
