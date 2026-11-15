import * as Speech from 'expo-speech';

import type { Narrator } from '@/narration/Narrator';

import type { SettingsStore } from './settings';

// expo-speech with the user's speech rate from the agent's settings. Used only when no screen reader is
// running; with VoiceOver the user's own VoiceOver rate applies. When AKH-4's narration module brings its
// own rate setting, this file goes and the adapter points at that.
export class RatedSpeechNarrator implements Narrator {
  private readonly listeners = new Set<() => void>();
  private current = 0;
  private active = false;

  constructor(private readonly settings: SettingsStore) {}

  speak(text: string): void {
    const utterance = ++this.current;
    this.active = true;
    void Speech.stop();
    const end = (done: boolean) => () => {
      if (utterance !== this.current) return;
      this.active = false;
      if (done) this.listeners.forEach((listener) => listener());
    };
    Speech.speak(text.slice(0, Speech.maxSpeechInputLength), { rate: this.settings.get().rate, onDone: end(true), onStopped: end(false), onError: end(false) });
  }

  stop(): void {
    this.current += 1;
    this.active = false;
    void Speech.stop();
  }

  speaking(): boolean {
    return this.active;
  }

  onDone(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
