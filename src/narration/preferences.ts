import { Platform } from 'react-native';

import type { KeyValueStore } from '@/storage/keyValueStore';

import type { DetailLevel } from './buildNarration';

export type NarrationPreferences = {
  mode: 'full' | 'brief';
  rate: number;
  skipHashtags: boolean;
  detail: DetailLevel;
  earcons: boolean;
};

// iOS does not let apps read the Spoken Content rate, so the in-app rate starts at normal speed.
// VoiceOver users are unaffected: with VoiceOver on, narration is spoken by VoiceOver at its own rate.
export const DEFAULT_PREFERENCES: NarrationPreferences = { mode: 'full', rate: 1, skipHashtags: false, detail: 'standard', earcons: true };
export const RATE_LIMITS = { min: 0.5, max: 3, step: 0.25 };

const STORAGE_KEY = 'narration.preferences';

export const clampRate = (rate: number) => Math.min(RATE_LIMITS.max, Math.max(RATE_LIMITS.min, Math.round(rate / RATE_LIMITS.step) * RATE_LIMITS.step));

export function stepRate(rate: number, direction: 'faster' | 'slower'): number {
  return clampRate(rate + (direction === 'faster' ? RATE_LIMITS.step : -RATE_LIMITS.step));
}

// expo-speech on iOS multiplies its rate by AVSpeechUtteranceDefaultSpeechRate (0.5), and AVSpeech
// caps at 1.0, so the engine accepts 0 to 2. AVSpeech's scale is not linear: its maximum is far more
// than twice normal. Rates up to 1x map directly and 1x to 3x spread over the engine's 1 to 2, so the
// app's 3x is the fastest the engine can speak. Android's TextToSpeech rate is a plain multiplier.
export function speechEngineRate(rate: number, os: string = Platform.OS): number {
  const clamped = clampRate(rate);
  if (os !== 'ios') return clamped;
  return clamped <= 1 ? clamped : 1 + (clamped - 1) / 2;
}

function sanitize(value: unknown): NarrationPreferences {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof NarrationPreferences, unknown>>;
  return {
    mode: saved.mode === 'brief' ? 'brief' : 'full',
    rate: typeof saved.rate === 'number' && Number.isFinite(saved.rate) ? clampRate(saved.rate) : DEFAULT_PREFERENCES.rate,
    skipHashtags: saved.skipHashtags === true,
    detail: saved.detail === 'detailed' ? 'detailed' : 'standard',
    earcons: saved.earcons !== false,
  };
}

export class PreferencesStore {
  private value = DEFAULT_PREFERENCES;
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<NarrationPreferences> | null = null;
  private changed = false;

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<NarrationPreferences> {
    this.loaded ??= this.store
      .get(STORAGE_KEY)
      .then((saved) => (saved ? sanitize(JSON.parse(saved)) : DEFAULT_PREFERENCES))
      .catch(() => DEFAULT_PREFERENCES)
      .then((saved) => {
        if (!this.changed) this.set(saved);
        return this.value;
      });
    return this.loaded;
  }

  get = (): NarrationPreferences => this.value;

  update(patch: Partial<NarrationPreferences>): NarrationPreferences {
    this.changed = true;
    this.set(sanitize({ ...this.value, ...patch }));
    this.store.set(STORAGE_KEY, JSON.stringify(this.value)).catch(() => undefined);
    return this.value;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(value: NarrationPreferences) {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}
