import { createMemoryStore } from '@/storage/keyValueStore';

import { DEFAULT_PREFERENCES, PreferencesStore, speechEngineRate, stepRate } from '../preferences';

describe('PreferencesStore', () => {
  it('starts from defaults and persists every change across launches', async () => {
    const store = createMemoryStore();
    const first = new PreferencesStore(store);
    expect(await first.load()).toEqual(DEFAULT_PREFERENCES);
    first.update({ mode: 'brief', rate: 2.25, skipHashtags: true, detail: 'detailed', earcons: false });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    const relaunched = new PreferencesStore(store);
    expect(relaunched.get()).toEqual(DEFAULT_PREFERENCES);
    expect(await relaunched.load()).toEqual({ mode: 'brief', rate: 2.25, skipHashtags: true, detail: 'detailed', earcons: false });
  });

  it('ignores corrupt or out-of-range saved values', async () => {
    const store = createMemoryStore();
    await store.set('narration.preferences', JSON.stringify({ mode: 'loud', rate: 99, earcons: 'yes' }));
    expect(await new PreferencesStore(store).load()).toEqual({ ...DEFAULT_PREFERENCES, rate: 3 });
    await store.set('narration.preferences', '{not json');
    expect(await new PreferencesStore(store).load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps a change made before the saved values finished loading', async () => {
    const store = createMemoryStore();
    await store.set('narration.preferences', JSON.stringify({ mode: 'brief' }));
    const preferences = new PreferencesStore(store);
    const loading = preferences.load();
    preferences.update({ rate: 1.5 });
    await loading;
    expect(preferences.get().rate).toBe(1.5);
  });

  it('notifies subscribers', () => {
    const preferences = new PreferencesStore(createMemoryStore());
    const listener = jest.fn();
    const unsubscribe = preferences.subscribe(listener);
    preferences.update({ mode: 'brief' });
    unsubscribe();
    preferences.update({ mode: 'full' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('speech rate', () => {
  it('steps by a quarter between half and three times normal', () => {
    expect(stepRate(1, 'faster')).toBe(1.25);
    expect(stepRate(1, 'slower')).toBe(0.75);
    expect(stepRate(3, 'faster')).toBe(3);
    expect(stepRate(0.5, 'slower')).toBe(0.5);
  });

  it("maps three times normal to the iOS engine's maximum", () => {
    expect(speechEngineRate(0.5, 'ios')).toBe(0.5);
    expect(speechEngineRate(1, 'ios')).toBe(1);
    expect(speechEngineRate(2, 'ios')).toBe(1.5);
    expect(speechEngineRate(3, 'ios')).toBe(2);
    expect(speechEngineRate(3, 'android')).toBe(3);
  });
});
