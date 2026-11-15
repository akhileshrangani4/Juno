import { RATE_LIMITS, type PreferencesStore } from '@/narration/preferences';

export type FeedNarrationMode = 'full' | 'brief';
export type PictureDetail = 'short' | 'long';

export type NarrationSettings = {
  rate: number;
  mode: FeedNarrationMode;
  skipHashtags: boolean;
  pictureDetail: PictureDetail;
};

// The feed's own range, so the agent and the feed can never disagree.
export const MIN_RATE = RATE_LIMITS.min;
export const MAX_RATE = RATE_LIMITS.max;
export const RATE_STEP = RATE_LIMITS.step;

export const defaultSettings: NarrationSettings = { rate: 1, mode: 'full', skipHashtags: false, pictureDetail: 'short' };

export type SettingsStore = {
  get(): NarrationSettings;
  load(): Promise<NarrationSettings>;
  update(patch: Partial<NarrationSettings>): Promise<NarrationSettings>;
  subscribe(listener: (settings: NarrationSettings) => void): () => void;
};

// The agent's view of the one set of narration preferences the feed uses (src/narration/preferences.ts), so a
// change the agent makes is what the feed reads next, and the other way round. "Long" picture descriptions are
// the model's detailed level; rate bounds and persistence are the feed's.
export function settingsStore(preferences: PreferencesStore): SettingsStore {
  const view = (): NarrationSettings => {
    const { rate, mode, skipHashtags, detail } = preferences.get();
    return { rate, mode, skipHashtags, pictureDetail: detail === 'detailed' ? 'long' : 'short' };
  };
  return {
    get: view,
    load: () => preferences.load().then(view),
    update: async ({ pictureDetail, ...patch }) => {
      preferences.update({ ...patch, ...(pictureDetail ? { detail: pictureDetail === 'long' ? 'detailed' : 'standard' } : {}) });
      return view();
    },
    subscribe: (listener) => preferences.subscribe(() => listener(view())),
  };
}
