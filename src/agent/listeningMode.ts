import type { KeyValueStore } from '@/storage/keyValueStore';

import type { Memory, MemoryClient } from './memoryClient';

// How the agent hears the user. Hands-free keeps the microphone open for the whole call. In push to talk the
// microphone is muted except while a finger is held on the screen.
export type ListeningMode = 'handsFree' | 'pushToTalk';

// How the call began: woken with the clockwise circle, or awake when the app opened (AKH-39).
export type CallStart = 'woken' | 'awake';

// Without a choice of the user's, a call they started on purpose listens hands-free, and one that was already
// running when the app opened waits for a held finger, so the room isn't heard by default.
export const defaultMode = (start: CallStart): ListeningMode => (start === 'awake' ? 'pushToTalk' : 'handsFree');

const STORAGE_KEY = 'agent.listening';

// The sentences kept in memory when signed in, so the choice follows the account to another phone.
export const MODE_MEMORIES: Record<ListeningMode, string> = {
  handsFree: 'I prefer hands-free listening.',
  pushToTalk: 'I prefer push to talk.',
};

export function modeFromMemories(memories: Memory[] | null): ListeningMode | null {
  const found = [...(memories ?? [])].reverse().find((memory) => Object.values(MODE_MEMORIES).includes(memory.text.trim()));
  if (!found) return null;
  return found.text.trim() === MODE_MEMORIES.pushToTalk ? 'pushToTalk' : 'handsFree';
}

// Replaces the remembered choice with the new one. Best effort: the phone's own copy is what the app reads first.
export async function rememberMode(memory: MemoryClient, mode: ListeningMode): Promise<void> {
  const stale = (await memory.list()).filter((item) => Object.values(MODE_MEMORIES).includes(item.text.trim()));
  if (stale.length === 1 && stale[0].text.trim() === MODE_MEMORIES[mode]) return;
  if (stale.length) await memory.forget(stale.map((item) => item.id));
  await memory.remember(MODE_MEMORIES[mode]);
}

type Saved = { mode: ListeningMode | null; introduced: boolean };

function sanitize(value: unknown): Saved {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return { mode: saved.mode === 'pushToTalk' || saved.mode === 'handsFree' ? saved.mode : null, introduced: saved.introduced === true };
}

// The listening mode in force for the current call, and the user's saved choice behind it, kept in the phone's
// preferences. Without a saved choice the mode follows how the call began.
export class ListeningModeStore {
  private saved: Saved = { mode: null, introduced: false };
  private current: ListeningMode = 'handsFree';
  private loaded: Promise<Saved> | null = null;
  private readonly listeners = new Set<(mode: ListeningMode) => void>();

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<Saved> {
    this.loaded ??= this.store
      .get(STORAGE_KEY)
      .then((raw) => (raw ? sanitize(JSON.parse(raw)) : this.saved))
      .catch(() => this.saved)
      .then((saved) => {
        this.saved = { mode: this.saved.mode ?? saved.mode, introduced: this.saved.introduced || saved.introduced };
        return this.saved;
      });
    return this.loaded;
  }

  get = (): ListeningMode => this.current;

  get savedMode(): ListeningMode | null {
    return this.saved.mode;
  }

  // Sets the mode for a new call: the saved choice, else the one remembered for the account, else the default.
  begin(start: CallStart, remembered: ListeningMode | null = null): ListeningMode {
    this.set(this.saved.mode ?? remembered ?? defaultMode(start));
    return this.current;
  }

  // The user chose a mode, by voice or with a VoiceOver action.
  choose(mode: ListeningMode): void {
    this.saved = { ...this.saved, mode };
    this.persist();
    this.set(mode);
  }

  // True once only, the first time a call starts in push to talk, so the agent says how to talk.
  takeIntroduction(): boolean {
    if (this.current !== 'pushToTalk' || this.saved.introduced) return false;
    this.saved = { ...this.saved, introduced: true };
    this.persist();
    return true;
  }

  subscribe = (listener: (mode: ListeningMode) => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(mode: ListeningMode) {
    if (mode === this.current) return;
    this.current = mode;
    this.listeners.forEach((listener) => listener(mode));
  }

  private persist() {
    this.store.set(STORAGE_KEY, JSON.stringify(this.saved)).catch(() => undefined);
  }
}
