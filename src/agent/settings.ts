import type { KeyValueStore } from '@/storage/keyValueStore';

export type FeedNarrationMode = 'full' | 'brief';
export type PictureDetail = 'short' | 'long';

export type NarrationSettings = {
  rate: number;
  mode: FeedNarrationMode;
  skipHashtags: boolean;
  pictureDetail: PictureDetail;
};

// Same range as the feed narration in consumerhack#3 (AKH-4). Take both bounds from its shared constant once that
// module is on main, so the agent and the feed can never disagree.
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_STEP = 0.25;

export const defaultSettings: NarrationSettings = { rate: 1, mode: 'full', skipHashtags: false, pictureDetail: 'short' };

const KEY = 'agent.narrationSettings';

const clampRate = (rate: number) => Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;

function sanitize(value: Partial<NarrationSettings>): NarrationSettings {
  return {
    rate: typeof value.rate === 'number' && Number.isFinite(value.rate) ? clampRate(value.rate) : defaultSettings.rate,
    mode: value.mode === 'brief' ? 'brief' : 'full',
    skipHashtags: value.skipHashtags === true,
    pictureDetail: value.pictureDetail === 'long' ? 'long' : 'short',
  };
}

export type SettingsStore = {
  get(): NarrationSettings;
  load(): Promise<NarrationSettings>;
  update(patch: Partial<NarrationSettings>): Promise<NarrationSettings>;
  subscribe(listener: (settings: NarrationSettings) => void): () => void;
};

export function createSettingsStore(store: KeyValueStore): SettingsStore {
  let current = defaultSettings;
  const listeners = new Set<(settings: NarrationSettings) => void>();
  const set = (next: NarrationSettings) => {
    current = next;
    listeners.forEach((listener) => listener(current));
    return current;
  };
  return {
    get: () => current,
    load: async () => {
      const saved = await store.get(KEY).catch(() => null);
      if (!saved) return current;
      try {
        return set(sanitize(JSON.parse(saved) as Partial<NarrationSettings>));
      } catch {
        return current;
      }
    },
    update: async (patch) => {
      const next = set(sanitize({ ...current, ...patch }));
      await store.set(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
