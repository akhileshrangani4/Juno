import { useEffect, useState } from 'react';

import { narrationPreferences } from '@/narration/postNarration';

import { settingsStore, type NarrationSettings } from './settings';

export const narrationSettings = settingsStore(narrationPreferences);

export function useNarrationSettings(): NarrationSettings {
  const [settings, setSettings] = useState(narrationSettings.get());
  useEffect(() => narrationSettings.subscribe(setSettings), []);
  return settings;
}
