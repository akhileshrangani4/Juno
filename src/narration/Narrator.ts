export interface Narrator {
  speak(text: string): void;
  append(text: string): void;
  stop(): void;
  speaking(): boolean;
  setRate(rate: number): void;
  onDone(listener: () => void): () => void;
}
