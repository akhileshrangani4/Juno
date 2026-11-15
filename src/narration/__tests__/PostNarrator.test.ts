import { createMemoryStore } from '@/storage/keyValueStore';
import { makePost } from '@/testing/fixtures';

import type { DescriptionParts, DetailLevel } from '../buildNarration';
import { DescriptionCache } from '../descriptions';
import type { Narrator } from '../Narrator';
import { PostNarrator } from '../PostNarrator';
import { PreferencesStore } from '../preferences';

const now = () => new Date('2026-11-15T12:00:00.000Z');
const parts: DescriptionParts = { images: [{ description: 'A cat on a sofa', beyondAlt: '' }], video: null, hashtagTopic: null };
const withImage = (uri = 'at://p/1') => makePost({ uri, media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] });

function fakeNarrator() {
  const log: string[] = [];
  const narrator: Narrator & { rate: number } = {
    rate: 1,
    speak: (text) => void log.push('speak: ' + text),
    append: (text) => void log.push('append: ' + text),
    stop: () => void log.push('stop'),
    speaking: () => false,
    setRate(rate) {
      this.rate = rate;
    },
    onDone: () => () => undefined,
  };
  return { narrator, log };
}

function setup({ earconMs = 0 } = {}) {
  const pending: { resolve: (parts: DescriptionParts | null) => void }[] = [];
  const describe = jest.fn((_uri: string, _detail: DetailLevel) => new Promise<DescriptionParts | null>((resolve) => pending.push({ resolve })));
  const descriptions = new DescriptionCache(describe);
  const preferences = new PreferencesStore(createMemoryStore());
  const { narrator, log } = fakeNarrator();
  const earcons = { play: jest.fn(() => earconMs) };
  const postNarrator = new PostNarrator({ narrator, descriptions, earcons, preferences, now });
  const settle = async (value: DescriptionParts | null, index = 0) => {
    pending[index].resolve(value);
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  };
  return { postNarrator, narrator, log, describe, preferences, earcons, settle, descriptions };
}

const spoken = (log: string[]) => log.filter((line) => line !== 'stop');

describe('PostNarrator', () => {
  afterEach(() => jest.useRealTimers());

  it('starts the deterministic narration at once and appends the description when it arrives for the same post', async () => {
    const { postNarrator, log, settle } = setup();
    postNarrator.focus(withImage());
    expect(spoken(log)).toEqual(['speak: Alice Chen, 2 hours ago. Hello world. One image, with no description yet.']);
    await settle(parts);
    expect(spoken(log)).toEqual([
      'speak: Alice Chen, 2 hours ago. Hello world. One image, with no description yet.',
      'append: About the image: A cat on a sofa.',
    ]);
  });

  it('only caches a description that arrives after the user moved on, and uses it on return', async () => {
    const { postNarrator, log, settle, describe } = setup();
    const first = withImage('at://p/1');
    postNarrator.focus(first);
    postNarrator.focus(makePost({ uri: 'at://p/2', text: 'Second' }));
    await settle(parts);
    expect(spoken(log)).toEqual(['speak: Alice Chen, 2 hours ago. Hello world. One image, with no description yet.', 'speak: Alice Chen, 2 hours ago. Second.']);
    postNarrator.focus(first);
    expect(spoken(log)[2]).toBe('speak: Alice Chen, 2 hours ago. Hello world. One image: A cat on a sofa.');
    expect(describe).toHaveBeenCalledTimes(1);
  });

  it('does not append after narration was stopped', async () => {
    const { postNarrator, log, settle } = setup();
    postNarrator.focus(withImage());
    postNarrator.stop();
    await settle(parts);
    expect(log.filter((line) => line.startsWith('append'))).toEqual([]);
  });

  it('speaks the full script straight away when the description is cached', async () => {
    const { postNarrator, log, descriptions, describe } = setup();
    describe.mockImplementationOnce(async () => parts);
    await descriptions.request(withImage(), 'standard');
    postNarrator.focus(withImage());
    expect(spoken(log)).toEqual(['speak: Alice Chen, 2 hours ago. Hello world. One image: A cat on a sofa.']);
  });

  it('holds a confirmation until the earcon and the post have played, and speaks it at once when nothing is playing', () => {
    jest.useFakeTimers();
    const { postNarrator, narrator, log } = setup({ earconMs: 200 });
    postNarrator.focus(withImage());
    postNarrator.sayAfter('Liked.');
    expect(spoken(log)).toEqual([]);
    jest.advanceTimersByTime(200);
    expect(spoken(log)).toEqual(['speak: Alice Chen, 2 hours ago. Hello world. One image, with no description yet.', 'append: Liked.']);
    narrator.speaking = () => true;
    postNarrator.sayAfter('Like removed.');
    expect(spoken(log).at(-1)).toBe('append: Like removed.');
    narrator.speaking = () => false;
    postNarrator.sayAfter('Liked.');
    expect(spoken(log).at(-1)).toBe('speak: Liked.');
    postNarrator.focus(withImage('at://p/2'));
    postNarrator.sayAfter('Gone with the post.');
    postNarrator.stop();
    jest.advanceTimersByTime(200);
    expect(spoken(log)).not.toContain('append: Gone with the post.');
  });

  it('plays the earcon first and starts speaking as it ends, folding in a description that lands meanwhile', async () => {
    jest.useFakeTimers();
    const { postNarrator, log, earcons, describe } = setup({ earconMs: 200 });
    let resolve!: (parts: DescriptionParts) => void;
    describe.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    postNarrator.focus(withImage());
    expect(earcons.play).toHaveBeenCalledWith('image');
    expect(spoken(log)).toEqual([]);
    resolve(parts);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(spoken(log)).toEqual([]);
    jest.advanceTimersByTime(200);
    expect(spoken(log)).toEqual(['speak: Alice Chen, 2 hours ago. Hello world. One image, with no description yet. About the image: A cat on a sofa.']);
  });

  it('counts as speaking while the earcon plays, before speech has started', () => {
    jest.useFakeTimers();
    const { postNarrator, narrator } = setup({ earconMs: 200 });
    expect(postNarrator.speaking()).toBe(false);
    postNarrator.focus(withImage());
    expect(narrator.speaking()).toBe(false);
    expect(postNarrator.speaking()).toBe(true);
    jest.advanceTimersByTime(200);
    expect(postNarrator.speaking()).toBe(false);
    postNarrator.focus(withImage());
    postNarrator.stop();
    expect(postNarrator.speaking()).toBe(false);
  });

  it('skips earcons when they are switched off, and applies the rate', () => {
    const { postNarrator, earcons, preferences, narrator } = setup({ earconMs: 200 });
    preferences.update({ earcons: false, rate: 2.5 });
    postNarrator.focus(withImage());
    expect(earcons.play).not.toHaveBeenCalled();
    expect(narrator.rate).toBe(2.5);
  });

  it('narrates in brief mode without fetching anything, and honours an explicit mode', () => {
    const { postNarrator, log, preferences, describe } = setup();
    preferences.update({ mode: 'brief' });
    postNarrator.focus(withImage());
    postNarrator.focus(withImage(), { mode: 'verbatim' });
    expect(spoken(log)).toEqual(['speak: Alice Chen. Hello world. Has an image.', 'speak: Hello world']);
    expect(describe).not.toHaveBeenCalled();
  });

  it('fetches detailed descriptions for the detailed image request', async () => {
    const { postNarrator, describe, log, settle } = setup();
    postNarrator.focus(withImage(), { mode: 'detailedImage' });
    expect(describe).toHaveBeenCalledWith(expect.anything(), 'detailed');
    await settle(parts);
    expect(spoken(log)).toEqual(['speak: Alice Chen. One image, with no description yet.', 'append: About the image: A cat on a sofa.']);
  });

  it('prefetches the next three posts in full mode only', () => {
    const { postNarrator, describe, preferences } = setup();
    postNarrator.prefetch([withImage('at://1'), withImage('at://2'), withImage('at://3'), withImage('at://4')]);
    expect(describe.mock.calls.map(([uri]) => uri)).toEqual(['at://1', 'at://2', 'at://3']);
    preferences.update({ mode: 'brief' });
    postNarrator.prefetch([withImage('at://5')]);
    expect(describe).toHaveBeenCalledTimes(3);
  });

  it('publishes the script, including a late description, with a prefix', async () => {
    const { postNarrator, settle } = setup();
    const scripts: string[] = [];
    postNarrator.onScript((script) => scripts.push(script));
    postNarrator.focus(withImage(), { prefix: 'Brief narration.' });
    await settle(parts);
    expect(scripts).toEqual([
      'Brief narration. Alice Chen, 2 hours ago. Hello world. One image, with no description yet.',
      'Brief narration. Alice Chen, 2 hours ago. Hello world. One image, with no description yet. About the image: A cat on a sofa.',
    ]);
  });
});
