import { act, render } from '@testing-library/react-native';

import { actionHistory } from '@/actions/history';
import { likeUriOf, recordLike } from '@/feed/likes';
import type { SocialAccount, SocialProvider } from '@/social/types';
import { makePost } from '@/testing/fixtures';

import { SessionProvider, useSession } from '../SessionContext';

jest.mock('@/backend/convex', () => ({ recordUser: jest.fn() }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});

const FAKE_APP_KEY = 'fake-app-key';
const me: SocialAccount = { id: 'did:plc:me', handle: 'me.bsky.social' };
const other: SocialAccount = { id: 'did:plc:other', handle: 'other.bsky.social' };
const post = makePost({ uri: 'at://maya/post/1' });

function fakeProvider() {
  let expire: (account: SocialAccount) => void = () => undefined;
  const provider = {
    id: 'bluesky',
    name: 'Bluesky',
    hasStoredSession: async () => false,
    restoreSession: jest.fn(async () => null),
    signOut: jest.fn(async () => undefined),
    signIn: jest.fn(async () => ({ status: 'success', account: me })),
    signInWithAppPassword: jest.fn(async () => other),
    onSessionExpired: (listener: (account: SocialAccount) => void) => {
      expire = listener;
      return () => undefined;
    },
  } as unknown as SocialProvider;
  return { provider, expire: (account: SocialAccount) => expire(account) };
}

async function setup() {
  const fake = fakeProvider();
  let session!: ReturnType<typeof useSession>;
  function Probe() {
    session = useSession();
    return null;
  }
  await render(
    <SessionProvider provider={fake.provider}>
      <Probe />
    </SessionProvider>,
  );
  return { fake, session: () => session };
}

function liked() {
  recordLike(post.uri, 'at://me/app.bsky.feed.like/1');
  actionHistory.push({ label: 'like', undo: async () => 'UNDONE' });
}

const cleared = () => likeUriOf(post) === null && actionHistory.size === 0;

describe("the viewer's own state", () => {
  it('is cleared on sign-out, on switching account or to the guest feed, and when the session ends', async () => {
    const { fake, session } = await setup();
    await act(async () => void (await session().signIn('me.bsky.social')));

    liked();
    await act(async () => session().signOut());
    expect(cleared()).toBe(true);

    liked();
    const { signInWithAppPassword } = session();
    await act(async () => void (await signInWithAppPassword.call(null, 'other.bsky.social', FAKE_APP_KEY)));
    expect(cleared()).toBe(true);

    liked();
    await act(async () => session().continueAsGuest());
    expect(cleared()).toBe(true);

    liked();
    await act(async () => fake.expire(other));
    expect(cleared()).toBe(true);
  });
});
