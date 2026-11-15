import { createMemoryStore } from '@/storage/keyValueStore';
import { maya } from '@/testing/agent';
import { makePost } from '@/testing/fixtures';

import { buildAssistant, MAX_DURATION_SECONDS, SILENCE_TIMEOUT_SECONDS } from '../assistant';
import { isDevAgentLink, onDevWake, requestDevWake } from '../devWake';
import { memoryRejection } from '../memoryClient';
import { PreferencesStore } from '@/narration/preferences';

import { detailFor, narrateForFeed, narratePost, usesDescriptions } from '../narrationAdapter';
import { describeAccount, describeFocus, describeMemories } from '../postContext';
import { defaultSettings, settingsStore } from '../settings';
import { toolNames } from '../tools';

const now = new Date('2026-11-15T12:00:00.000Z');

describe('narration adapter', () => {
  it('reads the feed in the mode the user chose, with the feed\'s own script', () => {
    expect(narrateForFeed(maya, { ...defaultSettings, mode: 'brief' }, null, now)).toBe('Maya. Meet our new puppy Biscuit! Has an image and two hashtags. 2 replies.');
    expect(narrateForFeed(maya, defaultSettings, null, now)).toBe(
      'Maya, 2 hours ago. Meet our new puppy Biscuit! One image: A golden puppy asleep on a red blanket. Its paws twitch. Tagged puppy and dogsofbluesky. 2 replies.',
    );
    expect(narrateForFeed(maya, { ...defaultSettings, skipHashtags: true }, null, now)).not.toContain('Tagged');
  });

  it('reads the exact words, the hashtags, and the pictures in detail', () => {
    const video = makePost({ media: [{ kind: 'video', alt: null, thumbUrl: null }] });
    const parts = { images: [], video: 'Opens on a cat mid-jump.', hashtagTopic: null };
    expect(narratePost(video, 'picture', defaultSettings, { now, parts })).toBe('Alice Chen. A video. Opens on a cat mid-jump.');
    expect(narratePost(makePost(), 'picture', defaultSettings, { now })).toBe('Alice Chen. This post has no images or video.');
    expect(narratePost(makePost({ text: 'plain' }), 'hashtags', defaultSettings, { now })).toBe('This post has no hashtags.');
    expect(narratePost(maya, 'hashtags', defaultSettings, { now })).toBe('2 hashtags: puppy, dogsofbluesky.');
    expect(narratePost(maya, 'exact', defaultSettings, { now })).toBe('Maya wrote, word for word: Meet our new puppy Biscuit! #puppy #dogsofbluesky');
  });

  it('asks for descriptions only for readings that use them, at the right detail', () => {
    expect(['full', 'brief', 'exact', 'hashtags', 'picture'].filter((mode) => usesDescriptions(mode as never))).toEqual(['full', 'picture']);
    expect(detailFor('picture', defaultSettings)).toBe('detailed');
    expect(detailFor('full', defaultSettings)).toBe('standard');
    expect(detailFor('full', { ...defaultSettings, pictureDetail: 'long' })).toBe('detailed');
  });
});

describe('settings', () => {
  it('are a view of the feed\'s preferences: persisted, clamped and shared', async () => {
    const store = createMemoryStore();
    const preferences = new PreferencesStore(store);
    const settings = settingsStore(preferences);
    const seen: number[] = [];
    settings.subscribe((next) => seen.push(next.rate));
    await settings.update({ rate: 9 });
    expect(settings.get().rate).toBe(3);
    await settings.update({ rate: 0.1, skipHashtags: true, pictureDetail: 'long' });
    expect(preferences.get()).toMatchObject({ rate: 0.5, skipHashtags: true, detail: 'detailed' });
    const reloaded = settingsStore(new PreferencesStore(store));
    expect(await reloaded.load()).toEqual({ ...defaultSettings, rate: 0.5, skipHashtags: true, pictureDetail: 'long' });
    expect(seen).toEqual([3, 0.5]);
    preferences.update({ mode: 'brief' });
    expect(settings.get().mode).toBe('brief');
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
    expect(assistant.clientMessages).toEqual(expect.arrayContaining(['tool-calls', 'transcript', 'status-update', 'speech-update', 'assistant.speechStarted']));
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
    expect(isDevAgentLink('juno://dev-agent')).toBe(false);
    expect(isDevAgentLink('consumerhack://dev-agent')).toBe(false);
    const wake = jest.fn();
    onDevWake(wake)();
    requestDevWake();
    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes the agent now, or when the feed mounts', () => {
    process.env.EXPO_PUBLIC_DEV_AGENT_LINK = '1';
    expect(isDevAgentLink('juno://dev-agent')).toBe(true);
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
