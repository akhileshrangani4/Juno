import * as Speech from 'expo-speech';

import { primary } from './language';
import type { Narrator, SpeakOptions } from './Narrator';
import { speechEngineRate } from './preferences';

export class ExpoSpeechNarrator implements Narrator {
  private readonly listeners = new Set<() => void>();
  private current = 0;
  private active = false;
  private rate = 1;
  private voices = new Set<string>();

  constructor() {
    void Speech.getAvailableVoicesAsync?.()
      .then((voices) => (this.voices = new Set(voices.map((voice) => primary(voice.language)))))
      .catch(() => undefined);
  }

  speak(text: string, options?: SpeakOptions): void {
    void Speech.stop();
    this.utter(text, options?.language);
  }

  canSpeak(language: string): boolean {
    return this.voices.has(primary(language));
  }

  append(text: string): void {
    this.utter(text);
  }

  stop(): void {
    this.current += 1;
    this.active = false;
    void Speech.stop();
  }

  speaking(): boolean {
    return this.active;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  onDone(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private utter(text: string, language?: string): void {
    const utterance = ++this.current;
    this.active = true;
    const end = (done: boolean) => () => {
      if (utterance !== this.current) return;
      this.active = false;
      if (done) this.listeners.forEach((listener) => listener());
    };
    Speech.speak(text.slice(0, Speech.maxSpeechInputLength), { rate: speechEngineRate(this.rate), ...(language ? { language } : {}), onDone: end(true), onStopped: end(false), onError: end(false) });
  }
}
