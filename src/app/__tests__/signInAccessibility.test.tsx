import { fireEvent, render, screen } from '@testing-library/react-native';

import type { SocialAccount } from '@/social/types';

import SignInScreen from '../sign-in';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));
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

type ReactTestRendererJSON = { type: string; props: Record<string, any>; children: (ReactTestRendererJSON | string)[] | null };

type Control = { role: string; label: string; hint: string };

function controls(): Control[] {
  const found: Control[] = [];
  const visit = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): void => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const { props } = node;
    if (node.type === 'TextInput') found.push({ role: 'textField', label: props.accessibilityLabel, hint: props.accessibilityHint });
    else if (props.accessibilityRole === 'button' || props.onClick || props.onPress) found.push({ role: props.accessibilityRole, label: props.accessibilityLabel, hint: props.accessibilityHint });
    node.children?.forEach(visit);
  };
  visit(screen.toJSON() as ReactTestRendererJSON | ReactTestRendererJSON[] | null);
  return found;
}

function expectLabeled(labels: string[]) {
  const found = controls();
  expect(found.map((control) => control.label)).toEqual(labels);
  for (const control of found) {
    expect(control.role === 'button' || control.role === 'textField').toBe(true);
    expect(control.hint).toEqual(expect.stringMatching(/\w/));
  }
}

describe('every sign-in and sign-up control has a label, a role and a hint', () => {
  beforeEach(() => {
    mockSession.account = null;
    mockSession.expiredAccount = null;
  });

  it('on the first screen, sign up, handle entry and the app password screen', async () => {
    await render(<SignInScreen />);
    expect(screen.getByRole('header', { name: 'Welcome to Juno' })).toBeTruthy();
    expectLabeled(['Sign in', 'Create an account', 'Listen without signing in']);

    await fireEvent.press(screen.getByRole('button', { name: 'Create an account' }));
    expectLabeled(['Open Bluesky sign-up', 'Back']);

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expectLabeled(['Bluesky handle', 'Continue', 'Use an app password instead', 'Back']);

    await fireEvent.press(screen.getByRole('button', { name: 'Use an app password instead' }));
    const appPassword = controls();
    expect(appPassword.length).toBeGreaterThan(1);
    expectLabeled(appPassword.map((control) => control.label));
  });

  it('on the account and sign-out confirmation screens', async () => {
    mockSession.account = { id: 'did:plc:me', handle: 'maya.bsky.social' };
    await render(<SignInScreen />);
    expectLabeled(['Back to the feed', 'Sign out']);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expectLabeled(['Sign out', 'Cancel']);
  });
});
