import { secureStore } from '@/storage/keyValueStore';

import type { DiscoveryProgress } from './discovery';
import { ALL_GESTURES, type GestureId } from './gestures';
import type { TipProgress } from './tips';

const KEY = 'app.gestureDiscovery';

export type SavedProgress = DiscoveryProgress & TipProgress;

const EMPTY: SavedProgress = { sessions: 0, learned: [], introduced: [], tipsOff: false, lastTipSession: 0 };

export async function loadDiscoveryProgress(): Promise<SavedProgress> {
  try {
    const saved = JSON.parse((await secureStore.get(KEY)) ?? '{}') as Partial<SavedProgress>;
    const known = new Set<string>(ALL_GESTURES.map((gesture) => gesture.id));
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is GestureId => known.has(id)) : []);
    return {
      sessions: typeof saved.sessions === 'number' ? saved.sessions : 0,
      learned: ids(saved.learned),
      introduced: ids(saved.introduced),
      tipsOff: saved.tipsOff === true,
      lastTipSession: typeof saved.lastTipSession === 'number' ? saved.lastTipSession : 0,
    };
  } catch {
    return EMPTY;
  }
}

export function saveDiscoveryProgress(progress: SavedProgress): void {
  secureStore.set(KEY, JSON.stringify(progress)).catch(() => undefined);
}
