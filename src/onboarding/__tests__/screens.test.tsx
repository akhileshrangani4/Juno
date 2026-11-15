import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { DiscoverySurface } from '../DiscoverySurface';
import { gestureHelp, GESTURES } from '../gestures';
import { PracticeScreen } from '../PracticeScreen';

const mockQuietListeners: (() => void)[] = [];
const mockNarrator = {
  speak: jest.fn(),
  stop: jest.fn(),
  speaking: jest.fn(() => false),
  onDone: jest.fn((listener: () => void) => {
    mockQuietListeners.push(listener);
    return () => undefined;
  }),
};
const narrationEnds = () => act(async () => mockQuietListeners.forEach((listener) => listener()));
const mockSurface: { props: Record<string, any> } = { props: {} };

jest.mock('@/narration/useNarrator', () => ({ useNarrator: () => mockNarrator }));
jest.mock('@/narration/postNarration', () => ({ postNarratorFor: () => ({ speaking: () => mockNarrator.speaking() }) }));
jest.mock('@/accessibility/useScreenReader', () => ({ useScreenReader: () => false }));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});
const mockWindow = { fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: mockWindow.fontScale }),
}));
jest.mock('react-native-gesture-handler', () => ({ ScrollView: jest.requireActual('react-native').ScrollView }));
jest.mock('@/gestures/GestureSurface', () => ({
  useStrokeGesture: () => null,
  GestureSurface: (props: Record<string, any> & { children?: ReactNode }) => {
    mockSurface.props = props;
    const { View: MockView } = jest.requireActual('react-native');
    return <MockView testID="surface" accessible={props.accessible} accessibilityLabel={props.accessibilityLabel}>{props.children}</MockView>;
  },
}));

const curve = Array.from({ length: 30 }, (_, i) => ({ x: 200 + 100 * Math.cos(i / 10), y: 300 + 100 * Math.sin(i / 10) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuietListeners.length = 0;
  jest.spyOn(Date, 'now').mockReturnValue(0);
});

const later = (ms: number) => (Date.now as jest.Mock).mockReturnValue(ms);

describe('PracticeScreen', () => {
  it('exposes the spoken instruction to VoiceOver and labels both buttons', async () => {
    await render(<PracticeScreen onDone={jest.fn()} />);
    expect(mockSurface.props.accessibilityLabel).toContain(`Step 1 of 4. ${GESTURES[0].instruction}`);
    expect(mockSurface.props.accessibilityHint).toBeTruthy();
    expect(mockSurface.props.accessibilityActions).toEqual([
      { name: 'activate', label: 'Repeat the instruction' },
      { name: 'skip', label: 'Skip practice' },
    ]);
    const repeat = screen.getByRole('button', { name: 'Repeat the instruction' });
    const skip = screen.getByRole('button', { name: 'Skip practice' });
    expect(repeat.props.accessibilityHint).toBeTruthy();
    expect(skip.props.accessibilityHint).toContain('account settings');
  });

  it('speaks each result and moves on, then leaves on a tap', async () => {
    const onDone = jest.fn();
    await render(<PracticeScreen onDone={onDone} />);
    await act(async () => mockSurface.props.onTapBottom());
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(expect.stringContaining('That was a tap on the bottom half.'));
    later(1000);
    await act(async () => mockSurface.props.onTapTop());
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(expect.stringContaining('Step 2 of 4.'));
    expect(mockSurface.props.accessibilityLabel).toContain('Step 2 of 4.');
    later(2000);
    await act(async () => mockSurface.props.onTapBottom());
    later(3000);
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(expect.stringContaining('That did not register.'));
    later(4000);
    await act(async () => mockSurface.props.onCircle('clockwise'));
    later(5000);
    await act(async () => mockSurface.props.onCircle('counterclockwise'));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    later(6000);
    await act(async () => mockSurface.props.onTapTop());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips from the button and from the VoiceOver action and escape', async () => {
    const onDone = jest.fn();
    const { unmount } = await render(<PracticeScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip practice' }));
    await unmount();
    await render(<PracticeScreen onDone={onDone} />);
    await act(async () => mockSurface.props.onAccessibilityAction({ nativeEvent: { actionName: 'skip' } }));
    await render(<PracticeScreen onDone={onDone} />);
    await act(async () => mockSurface.props.onAccessibilityEscape());
    expect(onDone).toHaveBeenCalledTimes(3);
  });

  it('lets the caption scroll instead of shrinking or clipping, so it stays readable at large text sizes', async () => {
    await render(<PracticeScreen onDone={jest.fn()} />);
    const caption = screen.getByTestId('practice-caption');
    expect(caption.type).toBe('RCTScrollView');
    expect(caption.props.persistentScrollbar).toBe(true);
    const text = screen.getByText(/^Let's practice 4 gestures/);
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    expect(text.props.allowFontScaling).not.toBe(false);
  });

  it('stops its own speech on the way out, and not on unmount, so the screen it returns to can announce itself', async () => {
    const onDone = jest.fn(() => expect(mockNarrator.stop).toHaveBeenCalledTimes(1));
    const { unmount } = await render(<PracticeScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip practice' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    mockNarrator.stop.mockClear();
    await unmount();
    expect(mockNarrator.stop).not.toHaveBeenCalled();
  });

  it('stacks Repeat and Skip practice at large text sizes so neither label breaks mid-word', async () => {
    mockWindow.fontScale = 1;
    const { unmount } = await render(<PracticeScreen onDone={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByTestId('practice-controls').props.style).flexDirection).toBe('row');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Skip practice' }).props.style).flex).toBe(1);
    await unmount();

    mockWindow.fontScale = 3.1;
    await render(<PracticeScreen onDone={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByTestId('practice-controls').props.style).flexDirection).toBe('column');
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Skip practice' }).props.style).flex).toBeUndefined();
    mockWindow.fontScale = 1;
  });

  it('lets the step title grow and scroll inside its half instead of shrinking, while both halves keep an equal share of the tap area', async () => {
    await render(<PracticeScreen onDone={jest.fn()} />);
    const title = screen.getByText(`${GESTURES[0].symbol} ${GESTURES[0].title}`);
    expect(title.props.adjustsFontSizeToFit).toBeUndefined();
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.allowFontScaling).not.toBe(false);
    for (const id of ['practice-step', 'practice-caption']) {
      const half = screen.getByTestId(id);
      expect(half.type).toBe('RCTScrollView');
      expect(half.props.persistentScrollbar).toBe(true);
      expect(StyleSheet.flatten(half.props.style).flex).toBe(1);
    }
  });

  it('repeats the instruction from the button', async () => {
    await render(<PracticeScreen onDone={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat the instruction' }));
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(`Step 1 of 4. ${GESTURES[0].instruction}`);
  });
});

describe('DiscoverySurface', () => {
  const renderFeed = (feedCue = jest.fn(), onAccessibilityAction = jest.fn()) =>
    render(
      <DiscoverySurface
        discoveryMode="scroll"
        tapsEnabled
        onTapTop={jest.fn()}
        onTapBottom={jest.fn()}
        onCircle={jest.fn()}
        onUnrecognizedStroke={feedCue}
        accessibilityActions={[{ name: 'activate', label: 'Next post' }]}
        onAccessibilityAction={onAccessibilityAction}>
        <View />
      </DiscoverySurface>,
    );

  it('adds a labeled Gesture help action that speaks the summary and passes other actions through', async () => {
    const feedAction = jest.fn();
    await renderFeed(jest.fn(), feedAction);
    await act(async () => undefined);
    expect(mockSurface.props.accessibilityActions).toEqual([
      { name: 'activate', label: 'Next post' },
      { name: 'gestureHelp', label: 'Gesture help' },
    ]);
    await act(async () => mockSurface.props.onAccessibilityAction({ nativeEvent: { actionName: 'gestureHelp' } }));
    expect(mockNarrator.speak).toHaveBeenCalledWith(gestureHelp());
    await act(async () => mockSurface.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    expect(feedAction).toHaveBeenCalledTimes(1);
  });

  it('replaces the feed cue with the stuck hint on the stroke where the hint fires', async () => {
    const feedCue = jest.fn();
    await renderFeed(feedCue);
    await act(async () => undefined);
    await narrationEnds();
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    expect(feedCue).toHaveBeenCalledTimes(2);
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    expect(feedCue).toHaveBeenCalledTimes(2);
    expect(mockNarrator.speak).toHaveBeenCalledWith(GESTURES[2].hint);
  });

  it('stays silent while the agent is awake and starts over once back to scrolling', async () => {
    const feedCue = jest.fn();
    const surface = (mode: 'scroll' | 'agent') => (
      <DiscoverySurface discoveryMode={mode} tapsEnabled onTapTop={jest.fn()} onTapBottom={jest.fn()} onCircle={jest.fn()} onUnrecognizedStroke={feedCue} accessibilityActions={[]}>
        <View />
      </DiscoverySurface>
    );
    const { rerender } = await render(surface('scroll'));
    await act(async () => undefined);
    await narrationEnds();
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await rerender(surface('agent'));
    expect(mockSurface.props.accessibilityActions).toEqual([]);
    for (let i = 0; i < 3; i += 1) await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await act(async () => mockSurface.props.onAccessibilityAction({ nativeEvent: { actionName: 'gestureHelp' } }));
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    await rerender(surface('scroll'));
    await narrationEnds();
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(feedCue).toHaveBeenCalledTimes(7);
    await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    expect(mockNarrator.speak).toHaveBeenCalledWith(GESTURES[2].hint);
  });

  it('drops a hint held for the end of a post when the agent woke without a gesture, such as the developer wake', async () => {
    mockNarrator.speaking.mockReturnValue(true);
    const surface = (mode: 'scroll' | 'agent') => (
      <DiscoverySurface discoveryMode={mode} tapsEnabled onTapTop={jest.fn()} onTapBottom={jest.fn()} onCircle={jest.fn()} accessibilityActions={[]}>
        <View />
      </DiscoverySurface>
    );
    const { rerender } = await render(surface('scroll'));
    await act(async () => undefined);
    for (let i = 0; i < 3; i += 1) await act(async () => mockSurface.props.onUnrecognizedStroke(curve));
    await rerender(surface('agent'));
    mockNarrator.speaking.mockReturnValue(false);
    await narrationEnds();
    expect(mockNarrator.speak).not.toHaveBeenCalled();
  });

  it('forwards magic tap and escape, and passes neither when the feed has none', async () => {
    const onMagicTap = jest.fn();
    const onAccessibilityEscape = jest.fn();
    const { rerender } = await render(
      <DiscoverySurface discoveryMode="scroll" tapsEnabled onTapTop={jest.fn()} onTapBottom={jest.fn()} onCircle={jest.fn()} onMagicTap={onMagicTap} onAccessibilityEscape={onAccessibilityEscape}>
        <View />
      </DiscoverySurface>,
    );
    await act(async () => mockSurface.props.onMagicTap());
    await act(async () => mockSurface.props.onAccessibilityEscape());
    expect(onMagicTap).toHaveBeenCalledTimes(1);
    expect(onAccessibilityEscape).toHaveBeenCalledTimes(1);
    await rerender(
      <DiscoverySurface discoveryMode="scroll" tapsEnabled onTapTop={jest.fn()} onTapBottom={jest.fn()} onCircle={jest.fn()}>
        <View />
      </DiscoverySurface>,
    );
    expect(mockSurface.props.onMagicTap).toBeUndefined();
    expect(mockSurface.props.onAccessibilityEscape).toBeUndefined();
  });

  it('still forwards recognized gestures to the feed', async () => {
    const onTapTop = jest.fn();
    await render(
      <DiscoverySurface discoveryMode="scroll" tapsEnabled onTapTop={onTapTop} onTapBottom={jest.fn()} onCircle={jest.fn()}>
        <View />
      </DiscoverySurface>,
    );
    await act(async () => undefined);
    await act(async () => mockSurface.props.onTapTop());
    expect(onTapTop).toHaveBeenCalledTimes(1);
  });
});
