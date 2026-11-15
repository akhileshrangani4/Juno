import { act, render, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';

import Home from '@/app/index';
import type { SocialAccount, SocialProvider } from '@/social/types';
import { secureStore } from '@/storage/keyValueStore';

import { SessionProvider } from '../SessionContext';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
jest.mock('@/backend/convex', () => ({ recordUser: jest.fn() }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});
jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { Redirect: ({ href }: { href: string }) => <MockText>{`Redirect to ${href}`}</MockText> };
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

function fakeProvider(stored: boolean, restore: Promise<SocialAccount | null>): SocialProvider {
  return {
    id: 'bluesky',
    name: 'Bluesky',
    hasStoredSession: async () => stored,
    restoreSession: jest.fn(() => restore),
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
    const restore = deferred<SocialAccount | null>();
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
    await act(async () => restore.resolve(me));
    expect(screen.getByText('Feed')).toBeTruthy();
  });

  it('sends the user to sign in only once the stored session turns out to be invalid', async () => {
    const restore = deferred<SocialAccount | null>();
    await render(
      <SessionProvider provider={fakeProvider(true, restore.promise)}>
        <Home />
      </SessionProvider>,
    );
    await advance(6000);
    expect(screen.queryByText('Redirect to /sign-in')).toBeNull();
    await act(async () => restore.resolve(null));
    expect(screen.getByText('Redirect to /sign-in')).toBeTruthy();
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
});
