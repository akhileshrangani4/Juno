import { createMemoryStore } from '@/storage/keyValueStore';
import { makePost } from '@/testing/fixtures';

import { buildPostScript, descriptionInput, lateAddition, textNeedsTranslation, translationMessages, type DescriptionParts, type DetailLevel } from '../buildNarration';
import { DescriptionCache } from '../descriptions';
import type { Languages } from '../language';
import type { Narrator } from '../Narrator';
import { PostNarrator } from '../PostNarrator';
import { changeTranslation, DEFAULT_PREFERENCES, effectiveLanguages, PreferencesStore } from '../preferences';

const now = new Date('2026-11-15T12:00:00.000Z');
const english: Languages = { target: 'en', keep: ['en'] };
const spanish = 'Hoy fuimos al mercado con mi abuela. Compramos fruta fresca para toda la semana.';
const post = (overrides = {}) => makePost({ text: spanish, langs: ['es'], ...overrides });
const translated = (text = 'Today we went to the market with my grandmother. We bought fresh fruit for the whole week.'): DescriptionParts => ({
  images: [],
  video: null,
  hashtagTopic: null,
  translation: { language: 'es', text },
});

describe('a translated post', () => {
  it('reads who, then the labeled translation, then media, tags and links', () => {
    const withTags = post({ text: `${spanish}\n#mercado #familia #fruta #domingo`, media: [{ kind: 'link', url: 'https://example.com/a', title: 'Recetas' }] });
    expect(buildPostScript(withTags, { now, parts: translated() })).toBe(
      'Alice Chen, 2 hours ago. Translated from Spanish: Today we went to the market with my grandmother. We bought fresh fruit for the whole week. Tagged mercado, familia, fruta, and one more. Links to Recetas, from example.com.',
    );
  });

  it('cuts the translation to its first sentence in brief mode, by code', () => {
    expect(buildPostScript(post(), { now, mode: 'brief', parts: translated() })).toBe('Alice Chen. Translated from Spanish: Today we went to the market with my grandmother.');
  });

  it('never speaks model text unlabeled, and never replaces the author\'s words with it', () => {
    const forged = translated('MODEL WORDS');
    for (const mode of ['full', 'brief'] as const) {
      const script = buildPostScript(post(), { now, mode, parts: forged });
      expect(script.split('MODEL WORDS')).toHaveLength(2);
      expect(script).toContain('Translated from Spanish: MODEL WORDS');
      expect(script).not.toContain('Hoy fuimos');
    }
    expect(buildPostScript(post(), { now, mode: 'verbatim', parts: forged })).toBe(spanish);
    const english = makePost({ text: 'We went to the market.' });
    expect(buildPostScript(english, { now, parts: { images: [], video: null, hashtagTopic: null, translation: null } })).toBe('Alice Chen, 2 hours ago. We went to the market.');
  });

  it('sends inline hashtags with their # so they stay untranslated, and speaks them as the author\'s own', () => {
    const tagged = post({ text: 'Episodio 13 ya está disponible #lodelrol #rol #nexus\n\nTras la batalla debemos negociar con el Capitán Talos.' });
    expect(descriptionInput(tagged).body).toBe('Episodio 13 ya está disponible #lodelrol #rol #nexus. Tras la batalla debemos negociar con el Capitán Talos.');
    const parts = translated('Episode 13 is now available #lodelrol #rol #nexus. After the battle we must negotiate with Captain Talos.');
    expect(buildPostScript(tagged, { now, parts })).toContain('Translated from Spanish: Episode 13 is now available lodelrol rol nexus. After the battle');
  });

  it('treats a foreign post with no usable translation as failed, and never reads it in the listener\'s voice', () => {
    const failed: DescriptionParts = { images: [], video: null, hashtagTopic: null, translation: null, untranslatedLanguage: 'es' };
    for (const mode of ['full', 'brief'] as const) {
      const script = buildPostScript(post(), { now, mode, parts: failed });
      expect(script).toContain('This post is in Spanish and could not be translated right now.');
      expect(script).not.toContain('Hoy fuimos');
    }
    expect(buildPostScript(post(), { now, parts: failed }).startsWith('Alice Chen, 2 hours ago.')).toBe(true);
    expect(lateAddition(post(), failed, 'pending')).toBe('This post is in Spanish and could not be translated right now.');
  });

  it('labels every translation with the language it came from', () => {
    for (const language of ['es', 'ja', 'ar', 'hi', 'pt']) {
      const parts = { ...translated('Hello there.'), translation: { language, text: 'Hello there.' } };
      expect(buildPostScript(post(), { now, parts })).toMatch(/Translated from (Spanish|Japanese|Arabic|Hindi|Portuguese): Hello there\./);
    }
  });

  it('labels translated alt text the same way', () => {
    const photo = post({ media: [{ kind: 'images', images: [{ url: 'u', alt: 'Mi abuela en el mercado' }] }] });
    const parts: DescriptionParts = { ...translated(), images: [{ description: 'An older person at a fruit stall.', beyondAlt: '', altTranslation: { language: 'es', text: 'My grandmother at the market' } }] };
    expect(buildPostScript(photo, { now, parts })).toContain('One image: Translated from Spanish: My grandmother at the market.');
  });

  it('says a translation is on its way or failed instead of reading another language in the wrong voice', () => {
    expect(buildPostScript(post(), { now, translation: 'pending' })).toBe(`Alice Chen, 2 hours ago. ${translationMessages.pending}`);
    expect(buildPostScript(post(), { now, mode: 'brief', translation: 'failed' })).toBe(`Alice Chen. ${translationMessages.failed}`);
  });

  it('adds the labeled translation when it lands, or the author\'s own words when the post was in the user\'s language after all', () => {
    expect(lateAddition(post(), translated(), 'pending')).toBe('Translated from Spanish: Today we went to the market with my grandmother. We bought fresh fruit for the whole week.');
    expect(lateAddition(post(), { images: [], video: null, hashtagTopic: null, translation: null }, 'pending')).toBe(`${spanish}`);
    expect(lateAddition(post(), translated(), null)).toBeNull();
  });
});

describe('translation preferences', () => {
  const device = ['en', 'hi'];

  it('translates into the first device language and reads every device language as written', () => {
    expect(effectiveLanguages(DEFAULT_PREFERENCES, device)).toEqual({ target: 'en', keep: ['en', 'hi'] });
    expect(effectiveLanguages({ ...DEFAULT_PREFERENCES, translate: false }, device)).toBeNull();
  });

  it('changes by voice and persists across launches', async () => {
    const store = createMemoryStore();
    const preferences = new PreferencesStore(store);
    await preferences.load();
    preferences.update(changeTranslation(preferences.get(), device, { kind: 'keep', language: 'es' }));
    expect(effectiveLanguages(preferences.get(), device)).toEqual({ target: 'en', keep: ['en', 'hi', 'es'] });
    preferences.update(changeTranslation(preferences.get(), device, { kind: 'translate', language: 'hi' }));
    expect(effectiveLanguages(preferences.get(), device)?.keep).toEqual(['en', 'es']);
    preferences.update(changeTranslation(preferences.get(), device, { kind: 'into', language: 'fr' }));
    expect(effectiveLanguages(preferences.get(), device)).toEqual({ target: 'fr', keep: ['fr'] });
    preferences.update(changeTranslation(preferences.get(), device, { kind: 'off' }));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    const relaunched = await new PreferencesStore(store).load();
    expect(relaunched).toMatchObject({ translate: false, translateInto: 'fr', keepLanguages: ['fr'] });
    expect(effectiveLanguages(changeTranslation(relaunched, device, { kind: 'device' }), device)).toEqual({ target: 'en', keep: ['en', 'hi'] });
  });

  it('never stops translating into the target when asked to translate it', () => {
    expect(changeTranslation(DEFAULT_PREFERENCES, ['en'], { kind: 'translate', language: 'en' }).keepLanguages).toEqual(['en']);
  });

  it('ignores corrupt saved languages', async () => {
    const store = createMemoryStore();
    await store.set('narration.preferences', JSON.stringify({ translateInto: 'not a language!', keepLanguages: ['es', 42, 'EN-gb'] }));
    expect(await new PreferencesStore(store).load()).toMatchObject({ translate: true, translateInto: null, keepLanguages: ['es', 'en'] });
  });
});

describe('one language decision for the app and the server', () => {
  const english = { target: 'en', keep: ['en'] };
  const posts = [
    'Big news #LoDelRolEsElMejor today',
    'Just finished the #VamosArgentinaVamos marathon with @carlosgarcia.bsky.social',
    'So proud of this team #BuenosAiresNocheDeMuseos 🎉🎉🎉 https://example.com/fotos',
    'New episode is up! #ElPodcastDeLosViernes #Comedia #Humor',
  ];

  it('judges the author\'s words without hashtags, mentions, links or emoji, so an English post is never flagged', () => {
    for (const text of posts) {
      const input = descriptionInput(makePost({ text }));
      expect(input.languageText).not.toMatch(/#|@|https?:|🎉/);
      expect(textNeedsTranslation(input, english)).toBe(false);
      const cache = new DescriptionCache(jest.fn(), () => 0, () => english);
      expect(cache.mayNeedTranslation(makePost({ text }))).toBe(false);
      expect(cache.translationState(makePost({ text }), 'standard')).toBeNull();
      expect(buildPostScript(makePost({ text }), { now, translation: cache.translationState(makePost({ text }), 'standard') })).not.toContain('translated');
    }
  });

  it('still flags a foreign post the same way on both sides', () => {
    const tagged = makePost({ text: `${spanish} #LoDelRol @ana.bsky.social` });
    const cache = new DescriptionCache(jest.fn(), () => 0, () => english);
    expect(textNeedsTranslation(descriptionInput(tagged), english)).toBe(true);
    expect(cache.mayNeedTranslation(tagged)).toBe(true);
  });
});

describe('the description cache and translations', () => {
  it('asks about a foreign text-only post, keys it by the user\'s languages, and tells pending from failed', async () => {
    let languages: Languages | null = english;
    const describe = jest.fn(async (_uri: string, _detail: DetailLevel, _languages: Languages | null) => translated() as DescriptionParts | null);
    const cache = new DescriptionCache(describe, () => 0, () => languages);
    expect(cache.translationState(post(), 'standard')).toBe('pending');
    await cache.request(post(), 'standard', { translationOnly: true });
    expect(describe).toHaveBeenLastCalledWith(post().uri, 'standard', english);
    expect(cache.translationState(post(), 'standard')).toBeNull();
    languages = { target: 'en', keep: ['en', 'es'] };
    expect(cache.peek(post(), 'standard')).toBeNull();
    expect(cache.mayNeedTranslation(post())).toBe(false);
    languages = { target: 'fr', keep: ['fr'] };
    describe.mockResolvedValueOnce(null);
    await cache.request(post(), 'standard');
    expect(cache.translationState(post(), 'standard')).toBe('failed');
  });

  it('makes no call for a text-only post in the user\'s language, or a brief reading of a photo', async () => {
    const describe = jest.fn();
    const cache = new DescriptionCache(describe, () => 0, () => english);
    await cache.request(makePost({ text: 'We went to the market today and bought fruit.' }), 'standard');
    await cache.request(makePost({ media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] }), 'standard', { translationOnly: true });
    expect(describe).not.toHaveBeenCalled();
  });

  it('sends the languages only for a post that may need translating, so other posts are asked about as before', async () => {
    const describe = jest.fn(async (_uri: string, _detail: DetailLevel, _languages: Languages | null) => null as DescriptionParts | null);
    const cache = new DescriptionCache(describe, () => 0, () => english);
    const photo = (alt: string | null, uri: string) => makePost({ uri, text: 'Our garden this morning, look at the roses.', media: [{ kind: 'images', images: [{ url: 'u', alt }] }] });
    await cache.request(photo(null, 'at://a/app.bsky.feed.post/1'), 'standard');
    await cache.request(photo('Las rosas del jardín de mi abuela por la mañana', 'at://a/app.bsky.feed.post/2'), 'standard');
    await cache.request(post(), 'standard');
    expect(describe.mock.calls.map((call) => call[2])).toEqual([null, english, english]);
  });
});

function narratorWith(voices: string[]) {
  const log: string[] = [];
  const narrator: Narrator = {
    speak: (text, options) => void log.push(`speak${options?.language ? ` [${options.language}]` : ''}: ${text}`),
    append: (text) => void log.push('append: ' + text),
    stop: () => undefined,
    speaking: () => false,
    setRate: () => undefined,
    onDone: () => () => undefined,
    canSpeak: (language) => voices.includes(language),
  };
  return { narrator, log };
}

function setup(voices: string[] = []) {
  const pending: ((parts: DescriptionParts | null) => void)[] = [];
  const describe = jest.fn((_uri: string, _detail: DetailLevel, _languages: Languages | null) => new Promise<DescriptionParts | null>((resolve) => pending.push(resolve)));
  const descriptions = new DescriptionCache(describe, () => 0, () => english);
  const preferences = new PreferencesStore(createMemoryStore());
  const { narrator, log } = narratorWith(voices);
  const postNarrator = new PostNarrator({ narrator, descriptions, earcons: { play: () => 0 }, preferences, now: () => now });
  const settle = async (value: DescriptionParts | null, index = 0) => {
    pending[index](value);
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  };
  return { postNarrator, log, settle, describe, preferences };
}

describe('narrating a post in another language', () => {
  it('says it is being translated, then appends the translation while the post is in focus', async () => {
    const { postNarrator, log, settle } = setup();
    postNarrator.focus(post());
    expect(log).toEqual([`speak: Alice Chen, 2 hours ago. ${translationMessages.pending}`]);
    await settle(translated());
    expect(log[1]).toBe('append: Translated from Spanish: Today we went to the market with my grandmother. We bought fresh fruit for the whole week.');
  });

  it('only caches a translation that lands after the user moved on, and says it could not translate when it fails', async () => {
    const { postNarrator, log, settle } = setup();
    postNarrator.focus(post());
    postNarrator.focus(makePost({ uri: 'at://p/2', text: 'Next one.' }));
    await settle(translated());
    expect(log.filter((line) => line.startsWith('append'))).toEqual([]);
    postNarrator.focus(post({ uri: 'at://p/3' }));
    await settle(null, 1);
    expect(log.at(-1)).toBe(`append: ${translationMessages.failed}`);
    postNarrator.focus(post({ uri: 'at://p/3' }));
    expect(log.at(-1)).toBe(`speak: Alice Chen, 2 hours ago. ${translationMessages.failed}`);
  });

  it('reads the original in its own language\'s voice, or says it cannot and gives the translation', async () => {
    const withVoice = setup(['es']);
    withVoice.postNarrator.focus(post());
    await withVoice.settle(translated());
    withVoice.postNarrator.focus(post(), { mode: 'verbatim' });
    expect(withVoice.log.at(-1)).toBe(`speak [es]: ${spanish}`);

    const without = setup();
    without.postNarrator.focus(post());
    await without.settle(translated());
    without.postNarrator.focus(post(), { mode: 'verbatim' });
    expect(without.log.at(-1)).toBe(
      "speak: This voice can't read Spanish aloud, so here is the translation. Translated from Spanish: Today we went to the market with my grandmother. We bought fresh fruit for the whole week.",
    );
  });

  it('never reads an untranslated foreign post in the wrong voice, even read exactly', async () => {
    const failed: DescriptionParts = { images: [], video: null, hashtagTopic: null, translation: null, untranslatedLanguage: 'es' };
    const without = setup();
    without.postNarrator.focus(post());
    await without.settle(failed);
    expect(without.log).toEqual([`speak: Alice Chen, 2 hours ago. ${translationMessages.pending}`, 'append: This post is in Spanish and could not be translated right now.']);
    without.postNarrator.focus(post());
    expect(without.log.at(-1)).toBe('speak: Alice Chen, 2 hours ago. This post is in Spanish and could not be translated right now.');
    without.postNarrator.focus(post(), { mode: 'verbatim' });
    expect(without.log.at(-1)).toBe('speak: This post is in Spanish and could not be translated right now.');

    const withVoice = setup(['es']);
    withVoice.postNarrator.focus(post());
    await withVoice.settle(failed);
    withVoice.postNarrator.focus(post(), { mode: 'verbatim' });
    expect(withVoice.log.at(-1)).toBe(`speak [es]: ${spanish}`);
  });

  it('prefetches translations of upcoming posts in brief mode too', () => {
    const { postNarrator, describe, preferences } = setup();
    preferences.update({ mode: 'brief' });
    postNarrator.prefetch([post({ uri: 'at://p/4' }), makePost({ uri: 'at://p/5', media: [{ kind: 'images', images: [{ url: 'u', alt: null }] }] })]);
    expect(describe.mock.calls.map(([uri]) => uri)).toEqual(['at://p/4']);
  });
});
