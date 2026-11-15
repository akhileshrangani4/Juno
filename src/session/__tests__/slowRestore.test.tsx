import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';

import Home from '@/app/index';
import { authMessages } from '@/auth/messages';
import type { RestoreResult, SocialAccount, SocialProvider } from '@/social/types';
import { secureStore } from '@/storage/keyValueStore';

import { SessionProvider } from '../SessionContext';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
jest.mock('@/backend/convex', () => ({ recordUser: jest.fn() }));
jest.mock('@/camera/cacheFileStore', () => ({ forgetLibraryDescriptions: jest.fn(async () => undefined) }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});
jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { Redirect: ({ href }: { href: string }) => <MockText>{`Redirect to ${href}`}</MockText>, router: { push: jest.fn() } };
});
jest.mock('@/screens/MainScreen', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { MainScreen: () => <MockText>Feed</MockText> };
});
jest.mock('@/screens/Intro', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { Intro: () => <MockText>Intro</MockText> };
});

const me: SocialAccount = { id: 'did:plc:me', handle: 'me.bsky.social' };

function fakeProvider(stored: boolean, ...restores: Promise<RestoreResult>[]): SocialProvider {
  return {
    id: 'bluesky',
    name: 'Bluesky',
    hasStoredSession: async () => stored,
    restoreSession: jest.fn(() => restores.shift() ?? new Promise(() => undefined)),
    signOut: jest.fn(async () => undefined),
    onSessionExpired: () => () => undefined,
  } as unknown as SocialProvider;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

describe('a slow session restore', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    await secureStore.set('app.onboarded', '1');
    await secureStore.remove('app.guest');
  });
  afterEach(() => jest.useRealTimers());

  it('keeps a stored-session user on the labeled loading state, says it is still connecting, then opens the feed', async () => {
    const restore = deferred<RestoreResult>();
    await render(
      <SessionProvider provider={fakeProvider(true, restore.promise)}>
        <Home />
      </SessionProvider>,
    );
    await advance(4000);
    expect(screen.getByLabelText('Still connecting to Bluesky')).toBeTruthy();
    expect(screen.queryByText('Redirect to /sign-in')).toBeNull();
    await advance(700);
    expect(Speech.speak).toHaveBeenCalledWith('Still connecting to Bluesky');
    await advance(10_000);
    expect(screen.queryByText('Redirect to /sign-in')).toBeNull();
    await act(async () => restore.resolve({ status: 'restored', account: me }));
    expect(screen.getByText('Feed')).toBeTruthy();
  });

  it('sends the user to sign in only once the stored session turns out to be invalid', async () => {
    const restore = deferred<RestoreResult>();
    await render(
      <SessionProvider provider={fakeProvider(true, restore.promise)}>
        <Home />
      </SessionProvider>,
    );
    await advance(6000);
    expect(screen.queryByText('Redirect to /sign-in')).toBeNull();
    await act(async () => restore.resolve({ status: 'invalid', account: me }));
    expect(screen.getByText('Redirect to /sign-in')).toBeTruthy();
    expect(jest.requireMock('expo-router').router.push).not.toHaveBeenCalled();
  });

  it('does not wait on the network when there is no stored session', async () => {
    const provider = fakeProvider(false, new Promise(() => undefined));
    await secureStore.set('app.guest', '1');
    await render(
      <SessionProvider provider={provider}>
        <Home />
      </SessionProvider>,
    );
    await advance(0);
    expect(screen.getByText('Feed')).toBeTruthy();
    expect(provider.restoreSession).not.toHaveBeenCalled();
  });

  it('keeps an unreachable user signed in, says so, and offers Retry and Listen without signing in', async () => {
    const offline = deferred<RestoreResult>();
    const online = deferred<RestoreResult>();
    const provider = fakeProvider(true, offline.promise, online.promise);
    await render(
      <SessionProvider provider={provider}>
        <Home />
      </SessionProvider>,
    );
    await act(async () => offline.resolve({ status: 'unreachable' }));
    expect(screen.queryByText('Redirect to /sign-in')).toBeNull();
    expect(screen.getByRole('header', { name: "Can't reach Bluesky" })).toBeTruthy();
    expect(screen.getByText(authMessages.unreachable)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    const listen = screen.getByRole('button', { name: 'Listen without signing in' });
    expect(retry.props.accessibilityHint).toMatch(/stay signed in/);
    expect(listen.props.accessibilityHint).toMatch(/public feed/);
    expect(Speech.speak).toHaveBeenCalledWith(authMessages.unreachable, expect.anything());
    expect(provider.signOut).not.toHaveBeenCalled();

    await fireEvent.press(retry);
    expect(screen.getByText(authMessages.retrying)).toBeTruthy();
    expect(Speech.speak).toHaveBeenCalledWith(authMessages.retrying, expect.anything());
    expect(screen.getByRole('button', { name: 'Retrying' }).props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => online.resolve({ status: 'restored', account: me }));
    expect(screen.getByText('Feed')).toBeTruthy();
    expect(provider.restoreSession).toHaveBeenCalledTimes(2);
  });

  it('stops waiting after 20 seconds, announces that Bluesky could not be reached, and can listen without signing in', async () => {
    const provider = fakeProvider(true);
    await render(
      <SessionProvider provider={provider}>
        <Home />
      </SessionProvider>,
    );
    await advance(19_900);
    expect(screen.getByLabelText('Still connecting to Bluesky')).toBeTruthy();
    await advance(200);
    expect(screen.getByText(authMessages.unreachable)).toBeTruthy();
    expect(Speech.speak).toHaveBeenCalledWith(authMessages.unreachable, expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Listen without signing in' }));
    expect(screen.getByText('Feed')).toBeTruthy();
    expect(provider.signOut).not.toHaveBeenCalled();
    expect(await secureStore.get('app.guest')).toBeNull();
  });
});
