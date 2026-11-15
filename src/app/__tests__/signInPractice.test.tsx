import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';

import { authMessages } from '@/auth/messages';
import type { SocialAccount } from '@/social/types';

import SignInScreen from '../sign-in';

const mockFocus: { effect: (() => void) | null } = { effect: null };
const mockScreenReader = { on: false };

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined), maxSpeechInputLength: 4000 }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() },
    useFocusEffect: (effect: () => void) => {
      mockFocus.effect = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@/accessibility/useScreenReader', () => ({ useScreenReader: () => mockScreenReader.on }));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));

const mockSession = { account: null as SocialAccount | null, expiredAccount: null as SocialAccount | null };
jest.mock('@/session/SessionContext', () => ({
  useSession: () => ({
    ...mockSession,
    provider: { name: 'Bluesky', findAccount: jest.fn(async () => true) },
    signIn: jest.fn(),
    createAccount: jest.fn(),
    signInWithAppPassword: jest.fn(),
    signOut: jest.fn(async () => undefined),
    continueAsGuest: jest.fn(async () => undefined),
  }),
}));

const returnFromPractice = () => act(async () => mockFocus.effect!());
const spoken = () => jest.mocked(Speech.speak).mock.calls.map(([text]) => text);

beforeEach(() => {
  jest.clearAllMocks();
  mockScreenReader.on = false;
  mockSession.account = null;
});

describe('Practice the gestures on the first screen', () => {
  it('comes after Sign in, Create an account and Listen without signing in, as a labeled button with a hint', async () => {
    await render(<SignInScreen />);
    const labels = screen.getAllByRole('button').map((button) => button.props.accessibilityLabel);
    expect(labels).toEqual(['Sign in', 'Create an account', 'Listen without signing in', 'Practice the gestures']);
    const practice = screen.getByRole('button', { name: 'Practice the gestures' });
    expect(practice.props.accessibilityHint).toMatch(/come back here/);
    await fireEvent.press(practice);
    expect(router.push).toHaveBeenCalledWith('/practice');
  });

  it('announces the status line again when the user comes back from practice', async () => {
    await render(<SignInScreen />);
    expect(spoken()).toEqual([authMessages.choices]);
    await fireEvent.press(screen.getByRole('button', { name: 'Practice the gestures' }));
    await returnFromPractice();
    expect(spoken()).toEqual([authMessages.choices, authMessages.choices]);
  });

  it('moves VoiceOver focus to the status line when the user comes back from practice', async () => {
    jest.useFakeTimers();
    mockScreenReader.on = true;
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await render(<SignInScreen />);
    await act(async () => jest.advanceTimersByTime(300));
    expect(focus).toHaveBeenCalledTimes(1);
    await returnFromPractice();
    await act(async () => jest.advanceTimersByTime(300));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(spoken()).toEqual([]);
    jest.useRealTimers();
  });

  it('is on the account screen too, so a signed-in user can practice again from account settings', async () => {
    mockSession.account = { id: 'did:plc:me', handle: 'maya.bsky.social' };
    await render(<SignInScreen />);
    expect(screen.getByRole('button', { name: 'Practice the gestures' })).toBeTruthy();
  });
});
