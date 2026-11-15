import { secureStore } from '@/storage/keyValueStore';

import type { DiscoveryProgress } from './discovery';
import { GESTURES, type GestureId } from './gestures';

const KEY = 'app.gestureDiscovery';

export async function loadDiscoveryProgress(): Promise<DiscoveryProgress> {
  try {
    const saved = JSON.parse((await secureStore.get(KEY)) ?? '{}') as Partial<DiscoveryProgress>;
    const known = new Set<string>(GESTURES.map((gesture) => gesture.id));
    return {
      sessions: typeof saved.sessions === 'number' ? saved.sessions : 0,
      learned: Array.isArray(saved.learned) ? saved.learned.filter((id): id is GestureId => known.has(id)) : [],
    };
  } catch {
    return { sessions: 0, learned: [] };
  }
}

export function saveDiscoveryProgress(progress: DiscoveryProgress): void {
  secureStore.set(KEY, JSON.stringify(progress)).catch(() => undefined);
}
