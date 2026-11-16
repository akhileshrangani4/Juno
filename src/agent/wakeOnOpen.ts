import { secureStore, type KeyValueStore } from '@/storage/keyValueStore';

// Whether the agent wakes by itself when Juno opens on the feed. On by default; switched by voice.
const STORAGE_KEY = 'agent.wakeOnOpen';

export class WakeOnOpenStore {
  // null until the stored value has been read.
  private value: boolean | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<boolean> {
    return this.store
      .get(STORAGE_KEY)
      .catch(() => null)
      .then((saved) => {
        if (this.value === null) this.notify(saved !== 'off');
        return this.value ?? true;
      });
  }

  get = (): boolean | null => this.value;

  set(on: boolean): void {
    this.store.set(STORAGE_KEY, on ? 'on' : 'off').catch(() => undefined);
    this.notify(on);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private notify(on: boolean) {
    this.value = on;
    this.listeners.forEach((listener) => listener());
  }
}

export const wakeOnOpen = new WakeOnOpenStore(secureStore);
void wakeOnOpen.load();

export type LaunchState = { setting: boolean | null; signedIn: boolean; onFeed: boolean; feedReady: boolean; awake: boolean };

// The one automatic wake of an app launch. It happens the first time the signed-in user is on the feed with a post
// to hear, and never again in this launch: not after the agent sleeps, a failed connect, or a return from the
// background. 'wait' means the setting hasn't been read yet, so the feed holds the first post for it.
export class LaunchWake {
  private done = false;

  decide({ setting, signedIn, onFeed, feedReady, awake }: LaunchState): 'wake' | 'wait' | 'no' {
    if (this.done || !signedIn || !onFeed || !feedReady) return 'no';
    if (awake) {
      this.done = true;
      return 'no';
    }
    if (setting === null) return 'wait';
    this.done = true;
    return setting ? 'wake' : 'no';
  }
}

export const launchWake = new LaunchWake();
