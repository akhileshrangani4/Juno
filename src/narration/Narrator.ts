export interface Narrator {
  speak(text: string): void;
  stop(): void;
  speaking(): boolean;
  onDone(listener: () => void): () => void;
}
