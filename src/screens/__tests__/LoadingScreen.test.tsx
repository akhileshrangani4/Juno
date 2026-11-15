import { act, render } from '@testing-library/react-native';
import * as Speech from 'expo-speech';

import { LoadingScreen } from '../LoadingScreen';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));

describe('LoadingScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says "Loading" once at startup even though two loading screens show in a row', async () => {
    const first = await render(<LoadingScreen />);
    await act(async () => void jest.advanceTimersByTime(700));
    await first.unmount();
    await render(<LoadingScreen />);
    await act(async () => void jest.advanceTimersByTime(700));
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledWith('Loading');
  });
});
