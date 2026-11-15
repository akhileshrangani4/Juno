import type { SocialProvider } from '@/social';
import type { KeyValueStore } from '@/storage/keyValueStore';

export const GUEST_KEY = 'app.guest';

export async function signOut(provider: SocialProvider, store: KeyValueStore): Promise<void> {
  await provider.signOut().catch(() => undefined);
  await store.remove(GUEST_KEY);
}
