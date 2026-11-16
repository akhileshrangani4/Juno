import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Post } from '@/social/types';
import { haptic } from '@/feedback/haptics';
import { introInstructions, messages } from '@/narration/buildNarration';
import { makePost } from '@/testing/fixtures';

import { GESTURES } from '../gestures';
import { secureStore } from '@/storage/keyValueStore';

// Behaves like ExpoSpeechNarrator: append queues after what is playing, and done fires once the last part ends.
const mockSpeech = {
  queue: [] as string[],
  log: [] as string[],
  listeners: new Set<() => void>(),
  finish() {
    this.queue.shift();
    if (this.queue.length === 0) this.listeners.forEach((listener) => listener());
  },
};
const mockNarrator = {
  speak: jest.fn((text: string) => {
    mockSpeech.queue = [text];
    mockSpeech.log.push(text);
  }),
  append: jest.fn((text: string) => {
    mockSpeech.queue.push(text);
    mockSpeech.log.push(text);
  }),
  stop: jest.fn(() => {
    mockSpeech.queue = [];
  }),
  speaking: () => mockSpeech.queue.length > 0,
  setRate: jest.fn(),
  onDone: (listener: () => void) => {
    mockSpeech.listeners.add(listener);
    return () => void mockSpeech.listeners.delete(listener);
  },
};
const mockFeed: { post: Post } = { post: makePost() };
const mockEarcon = { ms: 0 };
const mockDescription: { resolve: ((parts: unknown) => void) | null } = { resolve: null };
const mockAgentCalls: { active: boolean; onExit(reason: string, message: string): void }[] = [];
const mockAgentSay = jest.fn((_text: string) => true);
let mockSurface: Record<string, any> = {};

jest.mock('@/narration/useNarrator', () => ({ useNarrator: () => mockNarrator }));
jest.mock('@/narration/earcons', () => ({ createEarconPlayer: () => ({ play: () => mockEarcon.ms }) }));
jest.mock('@/backend/convex', () => ({
  describePost: jest.fn(() => new Promise((resolve) => (mockDescription.resolve = resolve))),
}));
jest.mock('@/accessibility/useScreenReader', () => ({ useScreenReader: () => false }));
jest.mock('@/agent/useVoiceAgent', () => ({
  useVoiceAgent: (args: { active: boolean; onExit(reason: string, message: string): void }) => {
    mockAgentCalls.push(args);
    return { status: args.active ? 'listening' : null, say: mockAgentSay };
  },
}));
jest.mock('@/session/SessionContext', () => ({ useSession: () => ({ provider: {} }) }));
jest.mock('@/feed/useFeed', () => ({
  useFeed: () => ({ state: { posts: [mockFeed.post], index: 0, cursor: null, exhausted: true, loading: false, error: null }, post: mockFeed.post, go: jest.fn() }),
}));
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
const hints = GESTURES.map((gesture) => gesture.hint);
const spokenHints = () => [...mockNarrator.speak.mock.calls, ...mockAgentSay.mock.calls].map(([text]) => text).filter((text) => hints.includes(text));
const strokes = async (count: number) => {
  for (let i = 0; i < count; i += 1) await act(async () => mockSurface.onUnrecognizedStroke(curve));
};
const finishSpeech = () => act(async () => mockSpeech.finish());
let posts = 0;
const withImage = () => makePost({ uri: `at://post/${(posts += 1)}`, media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });
const description = { images: [{ description: 'A cat on a sofa', beyondAlt: '' }], video: null, hashtagTopic: null };

async function renderFeed() {
  await render(<MainScreen />);
  await act(async () => undefined);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSpeech.queue = [];
  mockSpeech.log = [];
  mockFeed.post = makePost();
  mockEarcon.ms = 0;
  mockDescription.resolve = null;
});

afterEach(() => jest.useRealTimers());

describe('stuck hints on the feed', () => {
  it('wait while a picture description that arrived after the post started is read, and come after it', async () => {
    mockFeed.post = withImage();
    await renderFeed();
    expect(mockNarrator.speaking()).toBe(true);

    await strokes(3);
    await act(async () => mockDescription.resolve!(description));
    expect(mockNarrator.append).toHaveBeenCalledWith('About the image: A cat on a sofa.');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(spokenHints()).toEqual([]);

    await finishSpeech();
    expect(spokenHints()).toEqual([]);
    await finishSpeech();
    expect(spokenHints()).toEqual([GESTURES[2].hint]);
    expect(mockSpeech.log.at(-2)).toBe('About the image: A cat on a sofa.');
    expect(mockSpeech.log.at(-1)).toBe(GESTURES[2].hint);
  });

  it('wait while the earcon plays, before speech has started, and come after the post', async () => {
    mockFeed.post = withImage();
    mockEarcon.ms = 160;
    await renderFeed();
    expect(mockNarrator.speaking()).toBe(false);

    await strokes(1);
    expect(mockSpeech.log).toEqual([]);
    await strokes(2);
    expect(mockNarrator.speaking()).toBe(false);
    expect(spokenHints()).toEqual([]);

    await act(async () => jest.advanceTimersByTime(160));
    expect(mockSpeech.log.at(-1)).toContain('Hello world');
    expect(spokenHints()).toEqual([]);
    await finishSpeech();
    expect(spokenHints()).toEqual([GESTURES[2].hint]);
  });

  it('give the haptic and the on-screen hint but no speech for a stroke that ends while the earcon plays', async () => {
    mockFeed.post = withImage();
    mockEarcon.ms = 160;
    const screen = await render(<MainScreen />);
    await act(async () => undefined);
    await act(async () => jest.advanceTimersByTime(100));
    await strokes(1);
    expect(haptic).toHaveBeenCalledWith('unrecognized');
    expect(screen.getByText(messages.unrecognized)).toBeTruthy();
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(60));
    expect(mockSpeech.log).toEqual([expect.stringContaining('Hello world')]);
  });

  it('give no idle hint while the post is still being read', async () => {
    await renderFeed();
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(spokenHints()).toEqual([]);
  });

  it('give no stroke or idle hint and use no on-device speech while the agent call is up, then start over after it ends', async () => {
    await renderFeed();
    await act(async () => mockSurface.onCircle('clockwise'));
    expect(mockAgentCalls.at(-1)?.active).toBe(true);
    expect(mockSurface.accessibilityActions.map((action: { name: string }) => action.name)).not.toContain('gestureHelp');
    mockNarrator.speak.mockClear();
    mockNarrator.append.mockClear();
    mockAgentSay.mockClear();

    await strokes(4);
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(mockNarrator.speak).not.toHaveBeenCalled();
    expect(mockNarrator.append).not.toHaveBeenCalled();
    expect(spokenHints()).toEqual([]);

    await act(async () => mockAgentCalls.at(-1)!.onExit('silence', 'Going to sleep.'));
    expect(mockAgentCalls.at(-1)?.active).toBe(false);
    await finishSpeech();
    await strokes(1);
    await finishSpeech();
    await strokes(1);
    expect(spokenHints()).toEqual([]);
    await strokes(1);
    expect(spokenHints()).toEqual([GESTURES[2].hint]);
  });
});

describe('Gesture help in the rotor', () => {
  it('sits after the narration actions from #3 with a human label, once, and every rotor entry is distinct', async () => {
    await renderFeed();
    const actions: { name: string; label?: string }[] = mockSurface.accessibilityActions;
    const names = actions.map((action) => action.name);
    const labels = actions.map((action) => action.label);
    expect(names.filter((name) => name === 'gestureHelp')).toHaveLength(1);
    expect(names.at(-1)).toBe('gestureHelp');
    expect(actions.at(-1)?.label).toBe('Gesture help');
    expect(names).toEqual(expect.arrayContaining(['next', 'previous', 'reread', 'toggleAgent', 'narrationMode', 'faster', 'slower', 'earcons']));
    expect(new Set(names).size).toBe(names.length);
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('speaks the summary, and #3 narration actions still reach the feed', async () => {
    await renderFeed();
    mockNarrator.speak.mockClear();
    await act(async () => mockSurface.onAccessibilityAction({ nativeEvent: { actionName: 'gestureHelp' } }));
    expect(mockNarrator.speak).toHaveBeenLastCalledWith(expect.stringContaining('Tap the bottom half'));
    await act(async () => mockSurface.onAccessibilityAction({ nativeEvent: { actionName: 'narrationMode' } }));
    expect(mockSurface.accessibilityActions.find((action: { name: string }) => action.name === 'narrationMode').label).toBe('Full narration');
  });
});

describe('just-in-time tips on the feed', () => {
  const tipUp = 'Tip: swipe up to hear the replies to a post.';
  const withReplies = () => makePost({ uri: `at://post/${(posts += 1)}`, counts: { likes: 0, reposts: 0, replies: 2 } });

  beforeEach(() => secureStore.remove('app.gestureDiscovery'));

  it('offers swipe up on a post with replies and says it after the post, never over it', async () => {
    mockFeed.post = withReplies();
    await renderFeed();
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mockSpeech.log).not.toContain(tipUp);
    await finishSpeech();
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mockSpeech.log.at(-1)).toBe(tipUp);
    expect(mockSpeech.log.filter((text) => text === tipUp)).toHaveLength(1);
  });

  it('offers no tip on a post without replies', async () => {
    await renderFeed();
    await finishSpeech();
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(mockSpeech.log.filter((text) => text.startsWith('Tip:'))).toEqual([]);
  });

  it('names only the launch gestures in the first-launch intro', () => {
    expect(introInstructions(false)).toContain('Swiping right or left does the same.');
    expect(introInstructions(false)).not.toMatch(/swipe up|two fingers/i);
  });
});
