import * as Speech from 'expo-speech';

import type { Narrator } from './Narrator';

export class ExpoSpeechNarrator implements Narrator {
  private readonly listeners = new Set<() => void>();
  private current = 0;

  speak(text: string): void {
    const utterance = ++this.current;
    void Speech.stop();
    Speech.speak(text.slice(0, Speech.maxSpeechInputLength), {
      onDone: () => {
        if (utterance === this.current) this.listeners.forEach((listener) => listener());
      },
    });
  }

  stop(): void {
    this.current += 1;
    void Speech.stop();
  }

  onDone(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
