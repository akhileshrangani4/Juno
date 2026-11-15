import { useScreenReader } from '@/accessibility/useScreenReader';

import { ExpoSpeechNarrator } from './ExpoSpeechNarrator';
import type { Narrator } from './Narrator';
import { ScreenReaderNarrator } from './ScreenReaderNarrator';

const speechNarrator = new ExpoSpeechNarrator();
let screenReaderNarrator: ScreenReaderNarrator | null = null;

export function useNarrator(): Narrator {
  const screenReader = useScreenReader();
  if (!screenReader) return speechNarrator;
  screenReaderNarrator ??= new ScreenReaderNarrator();
  return screenReaderNarrator;
}
