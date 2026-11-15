import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { maya } from '@/testing/agent';

const mockPost = maya;

const mockNarrator = { speak: jest.fn(), append: jest.fn(), stop: jest.fn(), speaking: () => false, setRate: jest.fn(), onDone: jest.fn(() => () => undefined) };
const mockAgentCalls: { active: boolean; opening?: string | null; onExit(reason: string, message: string): void }[] = [];
const mockAgentSay = jest.fn((_text: string) => true);
const mockProvider = { like: jest.fn(), unlike: jest.fn(), post: jest.fn(), reply: jest.fn(), repost: jest.fn(), deletePost: jest.fn(), getReplies: jest.fn(async () => []) };
let mockSurface: { onCircle(direction: string): void; onSwipe(direction: string): void } | null = null;

jest.mock('@/narration/useNarrator', () => ({ useNarrator: () => mockNarrator }));
jest.mock('@/narration/earcons', () => ({ createEarconPlayer: () => ({ play: () => 0 }) }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean; opening?: string | null; onExit(reason: string, message: string): void }) => {
    mockAgentCalls.push(args);
    return { status: args.active ? 'listening' : null, say: mockAgentSay };
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
    GestureSurface: (props: { onCircle(direction: string): void; onSwipe(direction: string): void; children: ReactNode }) => {
      mockSurface = props;
      return <View>{props.children}</View>;
    },
  };
});

// eslint-disable-next-line import/first
import { POST_FIRST_MESSAGE, buildAssistant } from '@/agent/assistant';
// eslint-disable-next-line import/first
import { haptic } from '@/feedback/haptics';
// eslint-disable-next-line import/first
import { openAppLink } from '@/links/appLinks';
// eslint-disable-next-line import/first
import { narrateForFeed } from '@/agent/narrationAdapter';
// eslint-disable-next-line import/first
import { defaultSettings } from '@/agent/settings';
// eslint-disable-next-line import/first
import { MainScreen } from '@/screens/MainScreen';

const narration = narrateForFeed(maya, defaultSettings, null);
const latest = () => mockAgentCalls.at(-1)!;
const nothingPublic = () => {
  for (const call of Object.values(mockProvider)) if (call !== mockProvider.getReplies) expect(call).not.toHaveBeenCalled();
};

describe('opening the app from the widget, Siri or Shortcuts', () => {
  let screen: Awaited<ReturnType<typeof render>> | null = null;
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentCalls.length = 0;
  });
  afterEach(async () => {
    await screen?.unmount();
    screen = null;
  });

  it('juno://agent wakes the agent as the clockwise circle does, cold and warm', async () => {
    openAppLink('agent');
    screen = await render(<MainScreen />);
    expect(latest().active).toBe(true);
    expect(latest().opening).toBeNull();
    expect(haptic).toHaveBeenCalledWith('agentAwake');

    await act(async () => mockSurface!.onCircle('counterClockwise'));
    expect(latest().active).toBe(false);
    await act(async () => openAppLink('agent'));
    expect(latest().active).toBe(true);
    await act(async () => openAppLink('agent'));
    expect(mockAgentSay).not.toHaveBeenCalled();
    nothingPublic();
  });

  it('juno://feed reads the post in focus from the start, from the feed, the replies or the agent', async () => {
    screen = await render(<MainScreen />);
    mockNarrator.speak.mockClear();
    await act(async () => openAppLink('feed'));
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(narration);

    await act(async () => mockSurface!.onCircle('clockwise'));
    mockNarrator.speak.mockClear();
    await act(async () => openAppLink('feed'));
    expect(latest().active).toBe(false);
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(expect.stringContaining(narration));
    nothingPublic();
  });

  it('juno://feed on a cold start lets the feed read as it always does on opening', async () => {
    openAppLink('feed');
    screen = await render(<MainScreen />);
    expect(latest().active).toBe(false);
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(narration);
  });

  it('juno://post wakes the agent asking what to post, cold and warm, and publishes nothing by itself', async () => {
    openAppLink('post');
    screen = await render(<MainScreen />);
    expect(latest()).toMatchObject({ active: true, opening: 'post' });
    await act(async () => openAppLink('post'));
    expect(mockAgentSay).toHaveBeenCalledWith(POST_FIRST_MESSAGE);

    await act(async () => latest().onExit('user', 'Going to sleep.'));
    expect(latest()).toMatchObject({ active: false, opening: null });
    await act(async () => mockSurface!.onCircle('clockwise'));
    expect(latest()).toMatchObject({ active: true, opening: null });
    await act(async () => mockSurface!.onCircle('counterClockwise'));
    await act(async () => openAppLink('post'));
    expect(latest()).toMatchObject({ active: true, opening: 'post' });
    nothingPublic();
  });

  it('juno://post only changes the first words: the same tools, so a post still needs its draft, read-back and yes', () => {
    const context = { account: 'Signed in', settings: '', memories: 'Nothing yet.', focus: 'None', memoryOffer: 'Keep them?' };
    const usual = buildAssistant(context);
    const post = buildAssistant({ ...context, opening: 'post' });
    expect(post.firstMessage).toBe(POST_FIRST_MESSAGE);
    expect(post.model.tools).toEqual(usual.model.tools);
    expect(post.model.messages[0].content).toContain('call draft_post');
    expect(post.model.messages[0].content).toContain('publish_draft');
    expect(usual.model.messages[0].content).not.toContain('Your first words asked what they would like to post');
  });
});
