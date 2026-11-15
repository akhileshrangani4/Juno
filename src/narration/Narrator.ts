// language names the voice to use, for a post read in its own language; the default voice otherwise.
export type SpeakOptions = { language?: string };

export interface Narrator {
  speak(text: string, options?: SpeakOptions): void;
  // Whether a voice for this language is installed. Narrators that cannot choose a voice leave it out.
  canSpeak?(language: string): boolean;
  append(text: string): void;
  stop(): void;
  speaking(): boolean;
  setRate(rate: number): void;
  onDone(listener: () => void): () => void;
}
