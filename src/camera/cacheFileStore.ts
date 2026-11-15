import { File, Paths } from 'expo-file-system';

import type { KeyValueStore } from '@/storage/keyValueStore';

import { LIBRARY } from './library';

// Library descriptions, one file per key in the app's cache directory: iOS leaves Library/Caches out of iCloud
// and computer backups, and its files get the default data protection (unreadable until the phone is first
// unlocked after a restart). Not AsyncStorage, whose files are backed up.
export const cacheFileStore: KeyValueStore = {
  get: async (key) => {
    const file = new File(Paths.cache, `${key}.json`);
    return file.exists ? file.text() : null;
  },
  set: async (key, value) => {
    const file = new File(Paths.cache, `${key}.json`);
    if (!file.exists) file.create();
    file.write(value);
  },
  remove: async (key) => {
    const file = new File(Paths.cache, `${key}.json`);
    if (file.exists) file.delete();
  },
};

// Sign-out clears the library descriptions (and the old AsyncStorage copy an earlier build kept).
export async function forgetLibraryDescriptions(): Promise<void> {
  const legacy = async () => (await import('@react-native-async-storage/async-storage')).default.removeItem(LIBRARY.cacheKey);
  await Promise.all([cacheFileStore.remove(LIBRARY.cacheKey), legacy()]).catch(() => undefined);
}

