import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { maya } from '@/testing/agent';

import { GESTURES } from '../gestures';

const mockQuiet: (() => void)[] = [];
const mockNarrator = {
  speak: jest.fn(),
  stop: jest.fn(),
  speaking: jest.fn(() => false),
  onDone: jest.fn((listener: () => void) => {
    mockQuiet.push(listener);
    return () => undefined;
  }),
};
const mockAgentCalls: { active: boolean; onExit(reason: string, message: string): void }[] = [];
const mockAgentSay = jest.fn((_text: string) => true);
let mockSurface: Record<string, any> = {};

jest.mock('@/agent/narrationSettings', () => ({ useFeedNarrator: () => mockNarrator, useNarrationSettings: () => jest.requireActual('@/agent/settings').defaultSettings }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean; onExit(reason: string, message: string): void }) => {
    mockAgentCalls.push(args);
    return { status: args.active ? 'listening' : null, say: mockAgentSay };
  },
}));
jest.mock('@/session/SessionContext', () => ({ useSession: () => ({ provider: {} }) }));
jest.mock('@/feed/useFeed', () => ({
  useFeed: () => ({ state: { posts: [jest.requireActual('@/testing/agent').maya], index: 0, cursor: null, exhausted: true, loading: false, error: null }, post: jest.requireActual('@/testing/agent').maya, go: jest.fn() }),
}));
jest.mock('@/backend/convex', () => ({ fetchCachedDescription: jest.fn(async () => null) }));
jest.mock('@/feedback/haptics', () => ({ haptic: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));
jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});
jest.mock('@/screens/PostCard', () => ({ PostCard: () => null }));
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
import { MainScreen } from '@/screens/MainScreen';

const curve = Array.from({ length: 30 }, (_, i) => ({ x: 200 + 100 * Math.cos(i / 10), y: 300 + 100 * Math.sin(i / 10) }));
const narrationEnds = () => act(async () => mockQuiet.forEach((listener) => listener()));
const hints = GESTURES.map((gesture) => gesture.hint);
const spokenHints = () => [...mockNarrator.speak.mock.calls, ...mockAgentSay.mock.calls].map(([text]) => text).filter((text) => hints.includes(text));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockQuiet.length = 0;
});

afterEach(() => jest.useRealTimers());

describe('stuck hints with the real agent mode from #4', () => {
  it('give no stroke or idle hint and use no on-device speech while the agent call is up, then start over after it ends', async () => {
    await render(<MainScreen />);
    await act(async () => undefined);
    expect(maya).toBeTruthy();

    await act(async () => mockSurface.onCircle('clockwise'));
    expect(mockAgentCalls.at(-1)?.active).toBe(true);
    expect(mockSurface.accessibilityActions.map((action: { name: string }) => action.name)).not.toContain('gestureHelp');
    mockNarrator.speak.mockClear();
    mockAgentSay.mockClear();

    await narrationEnds();
    for (let i = 0; i < 4; i += 1) await act(async () => mockSurface.onUnrecognizedStroke(curve));
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(spokenHints()).toEqual([]);

    await act(async () => mockAgentCalls.at(-1)!.onExit('silence', 'Going to sleep.'));
    expect(mockAgentCalls.at(-1)?.active).toBe(false);
    await narrationEnds();
    await act(async () => mockSurface.onUnrecognizedStroke(curve));
    await act(async () => mockSurface.onUnrecognizedStroke(curve));
    expect(spokenHints()).toEqual([]);
    await act(async () => mockSurface.onUnrecognizedStroke(curve));
    expect(spokenHints()).toEqual([GESTURES[2].hint]);
  });
});
