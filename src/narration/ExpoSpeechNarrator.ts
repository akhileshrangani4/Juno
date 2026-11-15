import * as Speech from 'expo-speech';

import type { Narrator } from './Narrator';

export class ExpoSpeechNarrator implements Narrator {
  private readonly listeners = new Set<() => void>();
  private current = 0;
  private active = false;

  speak(text: string): void {
    const utterance = ++this.current;
    this.active = true;
    void Speech.stop();
    const end = (done: boolean) => () => {
      if (utterance !== this.current) return;
      this.active = false;
      if (done) this.listeners.forEach((listener) => listener());
    };
    Speech.speak(text.slice(0, Speech.maxSpeechInputLength), { onDone: end(true), onStopped: end(false), onError: end(false) });
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
