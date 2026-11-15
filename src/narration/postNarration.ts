import { useEffect, useSyncExternalStore } from 'react';

import { describePost } from '@/backend/convex';
import { secureStore } from '@/storage/keyValueStore';

import { DescriptionCache } from './descriptions';
import { deviceLanguages } from './deviceLanguages';
import { createEarconPlayer } from './earcons';
import type { Narrator } from './Narrator';
import { PostNarrator } from './PostNarrator';
import { effectiveLanguages, PreferencesStore, type NarrationPreferences } from './preferences';
import { useNarrator } from './useNarrator';

export const narrationPreferences = new PreferencesStore(secureStore);
export const descriptionCache = new DescriptionCache(describePost, Date.now, () => effectiveLanguages(narrationPreferences.get(), deviceLanguages()));
export const earcons = createEarconPlayer();
const postNarrators = new Map<Narrator, PostNarrator>();
let active: PostNarrator | null = null;

export function postNarratorFor(narrator: Narrator): PostNarrator {
  let postNarrator = postNarrators.get(narrator);
  if (!postNarrator) {
    postNarrator = new PostNarrator({ narrator, descriptions: descriptionCache, earcons, preferences: narrationPreferences });
    postNarrators.set(narrator, postNarrator);
  }
  return postNarrator;
}

export const activePostNarrator = () => active;

export function usePostNarrator(): PostNarrator {
  const postNarrator = postNarratorFor(useNarrator());
  useEffect(() => {
    active = postNarrator;
    void narrationPreferences.load();
    return () => {
      if (active === postNarrator) active = null;
    };
  }, [postNarrator]);
  return postNarrator;
}

export function useNarrationPreferences(): NarrationPreferences {
  return useSyncExternalStore(narrationPreferences.subscribe, narrationPreferences.get);
}
