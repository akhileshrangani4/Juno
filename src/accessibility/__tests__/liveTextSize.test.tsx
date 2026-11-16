import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, Dimensions, StyleSheet } from 'react-native';

import { makePost } from '@/testing/fixtures';

const mockNarrator = { speak: jest.fn(), append: jest.fn(), stop: jest.fn(), speaking: () => true, setRate: jest.fn(), onDone: () => () => undefined };
const mockAgentCalls: { active: boolean }[] = [];
const mockPost = makePost({ text: 'A post long enough to wrap at large sizes.' });
const mockGo = jest.fn();
let mockSurface: Record<string, any> = {};
const mockScreenReader = { on: false };

jest.mock('@/narration/useNarrator', () => ({ useNarrator: () => mockNarrator }));
jest.mock('@/narration/earcons', () => ({ createEarconPlayer: () => ({ play: () => 0 }) }));
jest.mock('@/backend/convex', () => ({ describePost: jest.fn(async () => null) }));
jest.mock('@/accessibility/useScreenReader', () => ({ useScreenReader: () => mockScreenReader.on }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean }) => {
    mockAgentCalls.push(args);
    return { status: args.active ? 'listening' : null, say: () => true };
  },
}));
jest.mock('@/session/SessionContext', () => ({
  useSession: () => ({ provider: {}, account: null, expiredAccount: null, createAccount: jest.fn(), continueAsGuest: jest.fn(), signOut: jest.fn() }),
}));
jest.mock('@/feed/useFeed', () => ({
  useFeed: () => ({ state: { posts: [mockPost], index: 0, cursor: null, exhausted: true, loading: false, error: null }, post: mockPost, go: mockGo }),
}));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true, useFocusEffect: jest.fn() }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});
jest.mock('react-native-gesture-handler', () => ({ ScrollView: jest.requireActual('react-native').ScrollView }));
jest.mock('@/gestures/GestureSurface', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useStrokeGesture: () => null,
    GestureSurface: (props: Record<string, any> & { children: ReactNode }) => {
      mockSurface = props;
      return <View>{props.children}</View>;
    },
  };
});

// eslint-disable-next-line import/first
import SignInScreen from '@/app/sign-in';
// eslint-disable-next-line import/first
import { authMessages } from '@/auth/messages';
// eslint-disable-next-line import/first
import { MainScreen } from '@/screens/MainScreen';

const setFontScale = (fontScale: number) =>
  act(async () => {
    Dimensions.set({ window: { ...Dimensions.get('window'), fontScale }, screen: { ...Dimensions.get('screen'), fontScale } });
  });
const fontSize = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).fontSize;

beforeEach(async () => {
  jest.clearAllMocks();
  mockAgentCalls.length = 0;
  mockScreenReader.on = false;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  await setFontScale(1);
});

afterEach(() => jest.restoreAllMocks());

describe('a text size change while the app is open', () => {
  it('resizes the feed without re-rendering the screen, so narration, the post in focus and the agent are left alone', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await render(<MainScreen />);
    await act(async () => undefined);
    const before = fontSize(mockPost.text);
    const value = mockSurface.accessibilityValue;
    const renders = mockAgentCalls.length;
    jest.clearAllMocks();

    await setFontScale(1.5);
    expect(fontSize(mockPost.text)).toBeCloseTo(before * 1.5);
    expect(mockAgentCalls).toHaveLength(renders);
    expect(mockSurface.accessibilityValue).toBe(value);
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(mockNarrator.append).not.toHaveBeenCalled();
    expect(mockNarrator.stop).not.toHaveBeenCalled();
    expect(mockGo).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('leaves a live agent call untouched', async () => {
    await render(<MainScreen />);
    await act(async () => mockSurface.onCircle('clockwise'));
    expect(mockAgentCalls.at(-1)?.active).toBe(true);
    const renders = mockAgentCalls.length;
    jest.clearAllMocks();

    await setFontScale(2.5);
    expect(mockAgentCalls).toHaveLength(renders);
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(mockNarrator.stop).not.toHaveBeenCalled();
  });

  it('does not speak the sign-in status again with VoiceOver off', async () => {
    await render(<SignInScreen />);
    expect(mockNarrator.speak).toHaveBeenCalledWith(authMessages.choices);
    mockNarrator.speak.mockClear();
    const before = fontSize('Sign in');
    await setFontScale(1.3);
    expect(fontSize('Sign in')).toBeCloseTo(before * 1.3);
    expect(mockNarrator.speak).not.toHaveBeenCalled();
  });

  it('does not move VoiceOver focus or announce anything with VoiceOver on', async () => {
    jest.useFakeTimers();
    mockScreenReader.on = true;
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await render(<SignInScreen />);
    await act(async () => jest.advanceTimersByTime(300));
    expect(focus).toHaveBeenCalledTimes(1);

    await setFontScale(2.2);
    await act(async () => jest.advanceTimersByTime(300));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
