import type { Post, SocialProvider } from '@/social/types';
import { createMemoryStore } from '@/storage/keyValueStore';
import { makePost } from '@/testing/fixtures';

import { ConversationLog } from '@/agent/AgentSession';
import type { Memory, MemoryClient } from '@/agent/memoryClient';
import type { MemoryOffer } from '@/agent/memoryOffer';
import { settingsStore } from '@/agent/settings';
import { PreferencesStore } from '@/narration/preferences';
import { createToolHandlers, type AgentDeps } from '@/agent/toolHandlers';

export function makeProvider(overrides: Partial<SocialProvider> = {}): jest.Mocked<SocialProvider> {
  let n = 0;
  return {
    id: 'bluesky',
    name: 'Bluesky',
    restoreSession: jest.fn(async () => null),
    signIn: jest.fn(),
    signOut: jest.fn(),
    getTimeline: jest.fn(),
    createPost: jest.fn(async () => ({ uri: `at://me/post/${++n}`, cid: `cid-${n}` })),
    reply: jest.fn(async () => ({ uri: `at://me/post/${++n}`, cid: `cid-${n}` })),
    repost: jest.fn(async () => ({ uri: 'at://me/repost/1' })),
    like: jest.fn(async () => ({ uri: 'at://me/like/1' })),
    uploadImage: jest.fn(),
    unlike: jest.fn(async () => true),
    unrepost: jest.fn(async () => true),
    deletePost: jest.fn(async () => undefined),
    getMyLatestPost: jest.fn(async () => null),
    serviceAuth: jest.fn(async () => 'proof'),
    ...overrides,
  } as jest.Mocked<SocialProvider>;
}

export function makeMemory(initial: Memory[] = []): jest.Mocked<MemoryClient> & { items: Memory[] } {
  const items = [...initial];
  let n = 0;
  return {
    items,
    list: jest.fn(async () => [...items]),
    remember: jest.fn(async (text: string) => {
      const memory = { id: `fact_${++n}`, text };
      items.push(memory);
      return memory;
    }),
    forget: jest.fn(async (ids: string[]) => {
      const gone = items.filter((item) => ids.includes(item.id));
      for (const item of gone) items.splice(items.indexOf(item), 1);
      return gone;
    }),
    savedSignedOut: jest.fn(async () => []),
    carryOver: jest.fn(async () => ({ carried: 0, left: 0 })),
  };
}

export function makeScheduler() {
  let now = 0;
  let tasks: { at: number; run: () => void }[] = [];
  return {
    schedule: (run: () => void, ms: number) => {
      const task = { at: now + ms, run };
      tasks.push(task);
      return () => {
        tasks = tasks.filter((candidate) => candidate !== task);
      };
    },
    async advance(ms: number) {
      now += ms;
      const due = tasks.filter((task) => task.at <= now);
      tasks = tasks.filter((task) => task.at > now);
      for (const task of due) task.run();
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
    },
    pending: () => tasks.length,
    now: () => now,
  };
}

export const maya = makePost({
  uri: 'at://did:plc:maya/app.bsky.feed.post/puppy',
  cid: 'cid-puppy',
  author: { id: 'did:plc:maya', handle: 'maya.bsky.social', displayName: 'Maya', avatarUrl: null },
  text: 'Meet our new puppy Biscuit! #puppy #dogsofbluesky',
  createdAt: '2026-11-15T10:00:00.000Z',
  media: [{ kind: 'images', images: [{ url: 'https://img/1.jpg', alt: 'A golden puppy asleep on a red blanket. Its paws twitch.' }] }],
  counts: { likes: 12, reposts: 3, replies: 2 },
});

export const nextPost = makePost({ uri: 'at://did:plc:sam/app.bsky.feed.post/2', cid: 'cid-2', text: 'Second post here.' });

export function setup(
  options: {
    signedIn?: boolean;
    focus?: Post | null;
    memory?: MemoryClient | null;
    memoryOffer?: MemoryOffer | null;
    provider?: jest.Mocked<SocialProvider>;
    readBacksHeard?: boolean;
  } = {},
) {
  const provider = options.provider ?? makeProvider();
  const scheduler = makeScheduler();
  const conversation = new ConversationLog();
  const notify = jest.fn();
  const settings = settingsStore(new PreferencesStore(createMemoryStore()));
  let focus: Post | null = options.focus === undefined ? maya : options.focus;
  let ids = 0;
  const deps: AgentDeps = {
    provider,
    account: () => (options.signedIn === false ? null : { id: 'did:plc:me', handle: 'me.bsky.social' }),
    focused: () => focus,
    move: (direction) => {
      if (direction === 'previous') return { outcome: 'atStart', post: null };
      focus = nextPost;
      return { outcome: 'moved', post: nextPost };
    },
    description: async () => null,
    cachedDescription: () => null,
    settings,
    memory: options.memory === undefined ? makeMemory() : options.memory,
    memoryOffer: options.memoryOffer ?? null,
    conversation,
    notify,
    schedule: scheduler.schedule,
    newId: () => `d${++ids}`,
    now: () => new Date(Date.parse('2026-11-15T12:00:00.000Z') + scheduler.now()),
  };
  const handlers = createToolHandlers(deps);
  // Stands in for the agent's voice, which hears each read-back played to the end, unless the test says it was cut off.
  const run = handlers.run;
  handlers.run = async (name, args) => {
    const outcome = await run(name, args);
    if (outcome.readBack && options.readBacksHeard !== false) handlers.readBackHeard(outcome.readBack);
    return outcome;
  };
  const say = (utterance: string) => conversation.add(utterance);
  const setFocus = (post: Post | null) => {
    focus = post;
  };
  return { provider, scheduler, conversation, notify, settings, handlers, say, deps, focus: () => focus, setFocus };
}
