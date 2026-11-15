export interface Narrator {
  speak(text: string): void;
  stop(): void;
  onDone(listener: () => void): () => void;
}
