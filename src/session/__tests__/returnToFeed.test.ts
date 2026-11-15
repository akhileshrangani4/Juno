import { router } from 'expo-router';

import { returnToFeed } from '../returnToFeed';

jest.mock('expo-router', () => ({ router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

const mocked = router as unknown as { canGoBack: jest.Mock; back: jest.Mock; replace: jest.Mock };

describe('returnToFeed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pops back to the feed that opened the account screen instead of stacking a new one', () => {
    mocked.canGoBack.mockReturnValue(true);
    returnToFeed();
    expect(mocked.back).toHaveBeenCalledTimes(1);
    expect(mocked.replace).not.toHaveBeenCalled();
  });

  it('opens the feed when sign in was the first screen', () => {
    mocked.canGoBack.mockReturnValue(false);
    returnToFeed();
    expect(mocked.replace).toHaveBeenCalledWith('/');
    expect(mocked.back).not.toHaveBeenCalled();
  });
});
