import { useEffect, useState } from 'react';

import { useScreenReader } from '@/accessibility/useScreenReader';
import type { Narrator } from '@/narration/Narrator';
import { useNarrator } from '@/narration/useNarrator';
import { secureStore } from '@/storage/keyValueStore';

import { RatedSpeechNarrator } from './ratedSpeechNarrator';
import { createSettingsStore, type NarrationSettings } from './settings';

export const narrationSettings = createSettingsStore(secureStore);
void narrationSettings.load();

const ratedNarrator = new RatedSpeechNarrator(narrationSettings);

export function useNarrationSettings(): NarrationSettings {
  const [settings, setSettings] = useState(narrationSettings.get());
  useEffect(() => narrationSettings.subscribe(setSettings), []);
  return settings;
}

// The feed's narrator with the user's speech rate applied; under a screen reader, the screen reader's.
export function useFeedNarrator(): Narrator {
  const screenReader = useScreenReader();
  const narrator = useNarrator();
  return screenReader ? narrator : ratedNarrator;
}
