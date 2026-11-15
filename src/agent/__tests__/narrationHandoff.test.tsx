import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { maya } from '@/testing/agent';

import { agentMessages } from '../agentMessages';
import { narrateForFeed } from '../narrationAdapter';
import { defaultSettings } from '../settings';

const mockPost = maya;
const mockNarrator = { speak: jest.fn(), stop: jest.fn(), onDone: jest.fn(() => () => undefined) };
const mockAgentCalls: { active: boolean; onExit(reason: string, message: string): void }[] = [];
let mockSurface: { onCircle(direction: string): void; onTapTop(): void } | null = null;
const mockAgentSay = jest.fn((_text: string) => true);

jest.mock('@/agent/narrationSettings', () => ({ useFeedNarrator: () => mockNarrator, useNarrationSettings: () => jest.requireActual('../settings').defaultSettings }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean; onExit(reason: string, message: string): void }) => {
    mockAgentCalls.push(args);
    return { status: args.active ? 'listening' : null, say: mockAgentSay };
  },
}));
jest.mock('@/session/SessionContext', () => ({ useSession: () => ({ provider: {} }) }));
jest.mock('@/feed/useFeed', () => ({
  useFeed: () => ({ state: { posts: [mockPost], index: 0, cursor: null, exhausted: true, loading: false, error: null }, post: mockPost, go: jest.fn() }),
}));
jest.mock('@/backend/convex', () => ({ fetchCachedDescription: jest.fn(async () => null) }));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/screens/PostCard', () => ({ PostCard: () => null }));
jest.mock('@/gestures/GestureSurface', () => {
  const { View } = jest.requireActual('react-native');
  return {
    GestureSurface: (props: { onCircle(direction: string): void; onTapTop(): void; children: ReactNode }) => {
      mockSurface = props;
      return <View>{props.children}</View>;
    },
  };
});

// eslint-disable-next-line import/first
import { haptic } from '@/feedback/haptics';
// eslint-disable-next-line import/first
import { messages } from '@/narration/buildNarration';
// eslint-disable-next-line import/first
import { MainScreen } from '@/screens/MainScreen';

const narration = narrateForFeed(maya, defaultSettings, null);

describe('narration hand-off between the feed and the agent', () => {
  it('stops narration the moment the agent wakes and resumes on the focused post when it sleeps', async () => {
    await render(<MainScreen />);
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(narration);
    expect(mockAgentCalls.at(-1)?.active).toBe(false);
    mockNarrator.speak.mockClear();
    mockNarrator.stop.mockClear();

    await act(async () => mockSurface!.onCircle('clockwise'));
    expect(mockNarrator.stop).toHaveBeenCalled();
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(mockAgentCalls.at(-1)?.active).toBe(true);

    await act(async () => mockAgentCalls.at(-1)!.onExit('silence', agentMessages.silence));
    expect(mockAgentCalls.at(-1)?.active).toBe(false);
    expect(mockNarrator.speak).toHaveBeenCalledTimes(1);
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(`${agentMessages.silence} ${narration}`);
  });

  it('never uses on-device speech while the agent is awake: help goes through the agent, or a haptic before it is live', async () => {
    await render(<MainScreen />);
    await act(async () => mockSurface!.onCircle('clockwise'));
    mockNarrator.speak.mockClear();
    jest.mocked(haptic).mockClear();

    await act(async () => mockSurface!.onTapTop());
    expect(mockAgentSay).toHaveBeenLastCalledWith(messages.gestures);
    await act(async () => mockSurface!.onCircle('clockwise'));
    expect(mockAgentSay).toHaveBeenLastCalledWith(messages.alreadyAwake);

    mockAgentSay.mockReturnValueOnce(false);
    await act(async () => mockSurface!.onTapTop());
    expect(haptic).toHaveBeenLastCalledWith('edge');
    expect(mockNarrator.speak).not.toHaveBeenCalled();
  });
});
