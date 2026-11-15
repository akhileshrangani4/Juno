import type { SocialProvider } from '@/social';
import type { KeyValueStore } from '@/storage/keyValueStore';

export const GUEST_KEY = 'app.guest';

// forgetOnDevice clears what the signed-in person left on the phone beyond the session (the camera's library
// descriptions).
export async function signOut(provider: SocialProvider, store: KeyValueStore, forgetOnDevice: () => Promise<void> = async () => undefined): Promise<void> {
  await provider.signOut().catch(() => undefined);
  await store.remove(GUEST_KEY);
  await forgetOnDevice().catch(() => undefined);
}
