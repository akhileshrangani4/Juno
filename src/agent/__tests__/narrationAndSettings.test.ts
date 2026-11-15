import { createMemoryStore } from '@/storage/keyValueStore';
import { maya } from '@/testing/agent';
import { makePost } from '@/testing/fixtures';

import { buildAssistant, MAX_DURATION_SECONDS, SILENCE_TIMEOUT_SECONDS } from '../assistant';
import { isDevAgentLink, onDevWake, requestDevWake } from '../devWake';
import { memoryRejection } from '../memoryClient';
import { hashtagsOf, narrateForFeed, narratePost, withoutHashtags } from '../narrationAdapter';
import { describeAccount, describeFocus, describeMemories } from '../postContext';
import { createSettingsStore, defaultSettings } from '../settings';
import { toolNames } from '../tools';

const now = new Date('2026-11-15T12:00:00.000Z');

describe('narration adapter', () => {
  it('finds and strips hashtags', () => {
    expect(hashtagsOf('Hi #one and #two! #three')).toEqual(['#one', '#two', '#three']);
    expect(withoutHashtags('Hi #one and #two! #three')).toBe('Hi and !');
  });

  it('reads the feed in the mode the user chose', () => {
    expect(narrateForFeed(maya, { ...defaultSettings, mode: 'brief' }, null, now)).toBe('Maya, 2 hours ago. Meet our new puppy Biscuit! It has an image.');
    expect(narrateForFeed(maya, defaultSettings, null, now)).toBe('Maya, 2 hours ago. Meet our new puppy Biscuit! #puppy #dogsofbluesky. One image: A golden puppy asleep on a red blanket.');
  });

  it('describes pictures in detail and says when there are none', () => {
    const post = makePost({ media: [{ kind: 'video', alt: null, thumbUrl: null }] });
    expect(narratePost(post, 'picture', defaultSettings, { now, description: 'A cat jumps. It lands.' })).toBe('The video: A cat jumps. It lands.');
    expect(narratePost(makePost(), 'picture', defaultSettings, { now })).toBe('This post has no pictures or video.');
    expect(narratePost(makePost({ text: 'plain' }), 'hashtags', defaultSettings, { now })).toBe('This post has no hashtags.');
  });
});

describe('settings', () => {
  it('persists, clamps and notifies', async () => {
    const store = createMemoryStore();
    const settings = createSettingsStore(store);
    const seen: number[] = [];
    settings.subscribe((next) => seen.push(next.rate));
    await settings.update({ rate: 9 });
    expect(settings.get().rate).toBe(3);
    await settings.update({ rate: 0.1, skipHashtags: true });
    const reloaded = createSettingsStore(store);
    expect(await reloaded.load()).toEqual({ ...defaultSettings, rate: 0.5, skipHashtags: true });
    expect(seen).toEqual([3, 0.5]);
  });
});

describe('agent context and config', () => {
  it('describes the focused post with media and counts', () => {
    expect(describeFocus(maya, null, now)).toBe(
      'Author: Maya (@maya.bsky.social). Posted 2 hours ago. Text: "Meet our new puppy Biscuit! #puppy #dogsofbluesky". Media: image 1: A golden puppy asleep on a red blanket. Its paws twitch.. Counts: 12 likes, 3 reposts, 2 replies.',
    );
    expect(describeFocus(null)).toMatch(/^No post is in focus/);
    expect(describeAccount(null)).toMatch(/^Not signed in/);
    expect(describeMemories([{ id: 'fact_1', text: 'Call the user Sam.' }])).toBe('- [fact_1] Call the user Sam.');
    expect(describeMemories(null)).toBe('Memory is unavailable right now.');
  });

  it('builds a transient assistant with client-side tools and call limits', () => {
    const assistant = buildAssistant({ account: 'Signed in.', settings: 'Speed 1.', memories: 'Nothing yet.', focus: describeFocus(maya, null, now) });
    expect(assistant.silenceTimeoutSeconds).toBe(SILENCE_TIMEOUT_SECONDS);
    expect(SILENCE_TIMEOUT_SECONDS).toBe(30);
    expect(assistant.maxDurationSeconds).toBe(MAX_DURATION_SECONDS);
    expect(assistant.clientMessages).toEqual(expect.arrayContaining(['tool-calls', 'transcript', 'status-update', 'speech-update']));
    expect(assistant.model.tools.map((tool) => tool.function.name)).toEqual(toolNames);
    for (const tool of assistant.model.tools) expect(tool).not.toHaveProperty('server');
    expect(assistant.model.messages[0].content).toContain('The post in focus: Author: Maya');
    expect(JSON.stringify(assistant)).not.toMatch(/accessJwt|refreshJwt|did:plc:me/);
  });
});

describe('memory rules', () => {
  it('rejects credentials, long text and other people\'s words', () => {
    expect(memoryRejection('Call the user Sam.', null)).toBeNull();
    expect(memoryRejection('My password is hunter2', null)).toBe('credential');
    expect(memoryRejection('x'.repeat(281), null)).toBe('tooLong');
    expect(memoryRejection('  ', null)).toBe('empty');
    expect(memoryRejection('Likes that the quick brown fox jumps over', 'The quick brown fox jumps over the dog')).toBe('othersContent');
  });
});

describe('dev wake link', () => {
  const original = process.env.EXPO_PUBLIC_DEV_AGENT_LINK;
  afterEach(() => {
    process.env.EXPO_PUBLIC_DEV_AGENT_LINK = original;
  });

  it('does nothing unless the build enables it', () => {
    delete process.env.EXPO_PUBLIC_DEV_AGENT_LINK;
    expect(isDevAgentLink('consumerhack://dev-agent')).toBe(false);
    const wake = jest.fn();
    onDevWake(wake)();
    requestDevWake();
    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes the agent now, or when the feed mounts', () => {
    process.env.EXPO_PUBLIC_DEV_AGENT_LINK = '1';
    expect(isDevAgentLink('consumerhack://dev-agent')).toBe(true);
    expect(isDevAgentLink('/dev-agent')).toBe(true);
    expect(isDevAgentLink('/sign-in')).toBe(false);
    requestDevWake();
    const wake = jest.fn();
    const off = onDevWake(wake);
    expect(wake).toHaveBeenCalledTimes(1);
    requestDevWake();
    expect(wake).toHaveBeenCalledTimes(2);
    off();
  });
});
