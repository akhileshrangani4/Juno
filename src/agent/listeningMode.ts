import type { KeyValueStore } from '@/storage/keyValueStore';

// How the agent hears the user. Hands-free keeps the microphone open for the whole call. In push to talk the
// microphone is muted except while a finger is held on the screen.
export type ListeningMode = 'handsFree' | 'pushToTalk';

const STORAGE_KEY = 'agent.listening';

type Saved = { mode: ListeningMode; introduced: boolean };

function parse(raw: string | null): Saved {
  try {
    const saved = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    return { mode: saved.mode === 'pushToTalk' ? 'pushToTalk' : 'handsFree', introduced: saved.introduced === true };
  } catch {
    return { mode: 'handsFree', introduced: false };
  }
}

// The user's choice of listening mode, kept on the phone; hands-free until they choose push to talk.
export class ListeningModeStore {
  private saved: Saved = { mode: 'handsFree', introduced: false };
  private readonly listeners = new Set<(mode: ListeningMode) => void>();
  readonly loaded: Promise<void>;

  constructor(private readonly store: KeyValueStore) {
    this.loaded = store
      .get(STORAGE_KEY)
      .then((raw) => {
        this.saved = parse(raw);
      })
      .catch(() => undefined);
  }

  get = (): ListeningMode => this.saved.mode;

  // The user chose a mode by voice. False when it was already the mode.
  choose(mode: ListeningMode): boolean {
    if (mode === this.saved.mode) return false;
    this.saved = { ...this.saved, mode };
    this.persist();
    this.listeners.forEach((listener) => listener(mode));
    return true;
  }

  // True once only, the first time push to talk is on, so the user hears how to talk.
  takeIntroduction(): boolean {
    if (this.saved.mode !== 'pushToTalk' || this.saved.introduced) return false;
    this.saved = { ...this.saved, introduced: true };
    this.persist();
    return true;
  }

  subscribe = (listener: (mode: ListeningMode) => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private persist() {
    this.store.set(STORAGE_KEY, JSON.stringify(this.saved)).catch(() => undefined);
  }
}
