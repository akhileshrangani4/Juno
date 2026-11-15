import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { maya, nextPost } from '@/testing/agent';

type Record = { uri: string };

let mockPost = maya;
let mockLike: () => Promise<Record> = async () => ({ uri: 'at://me/like/1' });
const mockProvider = { like: jest.fn(() => mockLike()), unlike: jest.fn(async () => true), getReplies: jest.fn(async () => []) };
const mockDone: (() => void)[] = [];
const mockNarrator = {
  speak: jest.fn(),
  append: jest.fn(),
  stop: jest.fn(),
  speaking: jest.fn(() => false),
  setRate: jest.fn(),
  onDone: jest.fn((listener: () => void) => {
    mockDone.push(listener);
    return () => undefined;
  }),
};
const mockPlay = jest.fn((_kind: string) => 0);
const mockAgentSay = jest.fn((_text: string) => true);
let mockAgentStatus = 'listening';
let mockAgentExit: ((reason: string, message: string) => void) | null = null;
let mockSurface: { onCircle(direction: string): void; onTwoFingerHold(): Promise<void>; onTwoFingerHoldWarning(): void; onTalkHold?: unknown } | null = null;

jest.mock('@/narration/useNarrator', () => ({ useNarrator: () => mockNarrator }));
jest.mock('@/narration/earcons', () => ({ createEarconPlayer: () => ({ play: (kind: string) => mockPlay(kind) }) }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean; onExit(reason: string, message: string): void }) => {
    mockAgentExit = args.onExit;
    return { status: args.active ? mockAgentStatus : null, say: mockAgentSay };
  },
}));
jest.mock('@/session/SessionContext', () => ({ useSession: () => ({ provider: mockProvider, account: { id: 'did:plc:me', handle: 'me.bsky.social' } }) }));
jest.mock('@/feed/useFeed', () => ({
  useFeed: () => ({ state: { posts: [mockPost], index: 0, cursor: null, exhausted: true, loading: false, error: null }, post: mockPost, go: jest.fn() }),
}));
jest.mock('@/backend/convex', () => ({ describePost: jest.fn(async () => null) }));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));
jest.mock('@/screens/PostCard', () => ({ PostCard: () => null }));
jest.mock('@/gestures/GestureSurface', () => {
  const { View } = jest.requireActual('react-native');
  return {
    GestureSurface: (props: { onCircle(direction: string): void; onTwoFingerHold(): Promise<void>; onTwoFingerHoldWarning(): void; children: ReactNode }) => {
      mockSurface = props;
      return <View>{props.children}</View>;
    },
  };
});

// eslint-disable-next-line import/first
import { actionHistory } from '@/actions/history';
// eslint-disable-next-line import/first
import { recordLike } from '@/feed/likes';
// eslint-disable-next-line import/first
import { haptic } from '@/feedback/haptics';
// eslint-disable-next-line import/first
import { commentMessages } from '@/narration/comments';
// eslint-disable-next-line import/first
import { MainScreen } from '@/screens/MainScreen';
// eslint-disable-next-line import/first
import { clearViewerState } from '@/session/viewerState';
// eslint-disable-next-line import/first
import { OfflineError } from '@/social/types';

function deferred() {
  let resolve!: (record: Record) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Record>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const spoken = () => mockNarrator.speak.mock.calls.map(([text]) => text);

describe('two-finger hold to like', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearViewerState();
    mockPost = maya;
    mockLike = async () => ({ uri: 'at://me/like/1' });
    mockNarrator.speaking.mockReturnValue(false);
    mockAgentSay.mockReturnValue(true);
    mockAgentStatus = 'listening';
  });

  it('warns with a light haptic before the like fires, and leaves the one-finger hold unconnected', async () => {
    await render(<MainScreen />);
    mockSurface!.onTwoFingerHoldWarning();
    expect(haptic).toHaveBeenLastCalledWith('holdWarning');
    expect(mockSurface!.onTalkHold).toBeUndefined();
  });

  it('answers at once with the like haptic and sound, and says "Liked." only when nothing is being said', async () => {
    await render(<MainScreen />);
    mockNarrator.speaking.mockReturnValue(true);
    mockNarrator.speak.mockClear();
    await act(async () => mockSurface!.onTwoFingerHold());
    expect(haptic).toHaveBeenCalledWith('like');
    expect(mockPlay).toHaveBeenCalledWith('like');
    expect(spoken()).toEqual([]);
    expect(actionHistory.size).toBe(1);

    await act(async () => recordLike(maya.uri, null));
    mockNarrator.speaking.mockReturnValue(false);
    await act(async () => mockSurface!.onTwoFingerHold());
    expect(spoken()).toEqual([commentMessages.liked]);
  });

  it('removes a like with its own haptic, sound and word', async () => {
    recordLike(maya.uri, 'at://me/like/9');
    await render(<MainScreen />);
    mockNarrator.speak.mockClear();
    await act(async () => mockSurface!.onTwoFingerHold());
    expect(haptic).toHaveBeenCalledWith('unlike');
    expect(mockPlay).toHaveBeenCalledWith('unlike');
    expect(mockProvider.unlike).toHaveBeenCalledWith(maya, { uri: 'at://me/like/9' });
    expect(spoken()).toEqual([commentMessages.unliked]);
  });

  it('says nothing more for a success that lands after the user moved on', async () => {
    const pending = deferred();
    mockLike = () => pending.promise;
    const screen = await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    mockPost = nextPost;
    await screen.rerender(<MainScreen />);
    mockNarrator.speak.mockClear();
    mockNarrator.append.mockClear();
    await act(async () => {
      pending.resolve({ uri: 'at://me/like/1' });
      await liking;
    });
    expect(spoken()).toEqual([]);
    expect(mockNarrator.append).not.toHaveBeenCalled();
  });

  it('always says a failure, naming the post it was made on, even after the user moved on', async () => {
    const pending = deferred();
    mockLike = () => pending.promise;
    const screen = await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    mockPost = nextPost;
    await screen.rerender(<MainScreen />);
    mockNarrator.speak.mockClear();
    await act(async () => {
      pending.reject(new OfflineError('down'));
      await liking;
    });
    expect(haptic).toHaveBeenLastCalledWith('likeFailed');
    expect(spoken()).toEqual(["Couldn't like Maya's post. Bluesky can't be reached. Check your connection."]);
    expect(actionHistory.size).toBe(0);
  });

  it('never speaks on the device once the agent has woken while the like was on the network', async () => {
    const failing = deferred();
    mockLike = () => failing.promise;
    await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    await act(async () => mockSurface!.onCircle('clockwise'));
    mockNarrator.speak.mockClear();
    await act(async () => {
      failing.reject(new Error('server error'));
      await liking;
    });
    expect(spoken()).toEqual([]);
    expect(mockAgentSay).toHaveBeenLastCalledWith("Couldn't like Maya's post. Nothing changed.");

    const succeeding = deferred();
    mockLike = () => succeeding.promise;
    mockAgentSay.mockClear();
    await act(async () => {
      const again = mockSurface!.onTwoFingerHold();
      succeeding.resolve({ uri: 'at://me/like/2' });
      await again;
    });
    expect(spoken()).toEqual([]);
    expect(mockAgentSay).not.toHaveBeenCalled();
    expect(mockPlay).toHaveBeenLastCalledWith('like');
  });

  it('says a failure in full after the speech in progress, without cutting it off', async () => {
    const failing = deferred();
    mockLike = () => failing.promise;
    await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    mockNarrator.speaking.mockReturnValue(true);
    mockNarrator.speak.mockClear();
    mockNarrator.stop.mockClear();
    await act(async () => {
      failing.reject(new OfflineError('down'));
      await liking;
    });
    expect(spoken()).toEqual([]);
    expect(mockNarrator.stop).not.toHaveBeenCalled();
    mockNarrator.speaking.mockReturnValue(false);
    await act(async () => mockDone.forEach((done) => done()));
    expect(spoken()).toEqual(["Couldn't like Maya's post. Bluesky can't be reached. Check your connection."]);
  });

  it('says a failure before the next post when the user moves on while something is being said', async () => {
    const failing = deferred();
    mockLike = () => failing.promise;
    const screen = await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    mockNarrator.speaking.mockReturnValue(true);
    await act(async () => {
      failing.reject(new Error('server error'));
      await liking;
    });
    mockNarrator.speak.mockClear();
    mockPost = nextPost;
    await screen.rerender(<MainScreen />);
    expect(spoken()).toHaveLength(1);
    expect(spoken()[0]).toMatch(/^Couldn't like Maya's post\. Nothing changed\. \S/);
  });

  it('holds a failure that comes while the call is connecting until the agent can say it', async () => {
    mockAgentStatus = 'connecting';
    mockAgentSay.mockReturnValue(false);
    const failing = deferred();
    mockLike = () => failing.promise;
    const screen = await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    await act(async () => mockSurface!.onCircle('clockwise'));
    mockNarrator.speak.mockClear();
    await act(async () => {
      failing.reject(new Error('server error'));
      await liking;
    });
    expect(spoken()).toEqual([]);
    expect(haptic).toHaveBeenLastCalledWith('likeFailed');
    expect(haptic).not.toHaveBeenCalledWith('edge');
    mockAgentSay.mockClear();
    mockAgentSay.mockReturnValue(true);
    mockAgentStatus = 'listening';
    await screen.rerender(<MainScreen />);
    expect(mockAgentSay).toHaveBeenCalledWith("Couldn't like Maya's post. Nothing changed.");
    expect(spoken()).toEqual([]);
  });

  it('says a held failure on the device once the app is back to scrolling, if the call never came up', async () => {
    mockAgentStatus = 'connecting';
    mockAgentSay.mockReturnValue(false);
    const failing = deferred();
    mockLike = () => failing.promise;
    await render(<MainScreen />);
    let liking: Promise<void> = Promise.resolve();
    await act(async () => {
      liking = mockSurface!.onTwoFingerHold();
    });
    await act(async () => mockSurface!.onCircle('clockwise'));
    await act(async () => {
      failing.reject(new Error('server error'));
      await liking;
    });
    mockNarrator.speak.mockClear();
    await act(async () => mockAgentExit!('failed', "Couldn't connect."));
    expect(spoken()).toHaveLength(1);
    expect(spoken()[0]).toMatch(/^Couldn't connect\. Couldn't like Maya's post\. Nothing changed\. \S/);
  });

  it('says an undo that failed after Bluesky answered the way it says a failed like', async () => {
    await render(<MainScreen />);
    mockNarrator.speak.mockClear();
    await act(async () => actionHistory.tell("Couldn't remove your like on Maya's post. Nothing changed."));
    expect(haptic).toHaveBeenLastCalledWith('likeFailed');
    expect(spoken()).toEqual(["Couldn't remove your like on Maya's post. Nothing changed."]);
  });
});
