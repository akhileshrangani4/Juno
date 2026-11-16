import { act, render, screen } from '@testing-library/react-native';
import { AppState, Dimensions, StyleSheet, Text as NativeText } from 'react-native';

import { useFontScale } from '../fontScale';
import { Text, TextInput } from '../ScaledText';

const setFontScale = (fontScale: number) =>
  act(async () => {
    const window = Dimensions.get('window');
    Dimensions.set({ window: { ...window, fontScale }, screen: { ...Dimensions.get('screen'), fontScale } });
  });

const style = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

function Probe() {
  return <NativeText testID="probe">{useFontScale()}</NativeText>;
}

const appStateListeners: ((state: string) => void)[] = [];

beforeEach(async () => {
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: string) => void);
    return { remove: jest.fn() };
  });
  await setFontScale(1);
});

afterEach(() => jest.restoreAllMocks());

describe('useFontScale', () => {
  it('follows the system font scale while the app is open', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('probe').props.children).toBe(1);
    await setFontScale(2.4);
    expect(screen.getByTestId('probe').props.children).toBe(2.4);
  });

  it('re-reads the scale when the app returns to the foreground', async () => {
    await render(<Probe />);
    const window = Dimensions.get('window');
    jest.spyOn(Dimensions, 'get').mockReturnValue({ ...window, fontScale: 1.8 });
    await act(async () => appStateListeners.forEach((listener) => listener('background')));
    expect(screen.getByTestId('probe').props.children).toBe(1);
    await act(async () => appStateListeners.forEach((listener) => listener('active')));
    expect(screen.getByTestId('probe').props.children).toBe(1.8);
  });
});

describe('Text and TextInput', () => {
  it('size text from the live scale, keep each element\'s cap, and leave the native multiplier off so nothing scales twice', async () => {
    await render(
      <>
        <Text testID="capped" style={{ fontSize: 20, lineHeight: 26 }} maxFontSizeMultiplier={1.6} />
        <Text testID="uncapped" style={{ fontSize: 20 }} />
        <Text testID="fixed" style={{ fontSize: 20 }} allowFontScaling={false} />
        <TextInput testID="input" style={{ fontSize: 26 }} maxFontSizeMultiplier={1.6} />
      </>,
    );
    expect(style('capped')).toMatchObject({ fontSize: 20, lineHeight: 26 });
    expect(screen.getByTestId('capped').props.allowFontScaling).toBe(false);
    expect(screen.getByTestId('input').props.allowFontScaling).toBe(false);

    await setFontScale(1.2);
    expect(style('capped')).toMatchObject({ fontSize: 24, lineHeight: 26 * 1.2 });
    expect(style('uncapped').fontSize).toBe(24);

    await setFontScale(3.1);
    expect(style('capped')).toMatchObject({ fontSize: 32, lineHeight: 26 * 1.6 });
    expect(style('uncapped').fontSize).toBeCloseTo(62);
    expect(style('fixed').fontSize).toBe(20);
    expect(style('input').fontSize).toBeCloseTo(26 * 1.6);
  });

  it('leaves a missing font size to be inherited instead of inventing one', async () => {
    await setFontScale(2);
    await render(<Text testID="plain">Hello</Text>);
    expect(style('plain').fontSize).toBeUndefined();
  });
});
