import { secureStore } from '@/storage/keyValueStore';

import { BlueskyProvider } from './bluesky/BlueskyProvider';
import type { SocialProvider } from './types';

export * from './types';

export function createSocialProvider(): SocialProvider {
  return new BlueskyProvider({
    store: secureStore,
    service: process.env.EXPO_PUBLIC_BLUESKY_SERVICE,
    demoFeed: process.env.EXPO_PUBLIC_BLUESKY_DEMO_FEED,
  });
}
