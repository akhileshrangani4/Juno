import { AccessibilityInfo } from 'react-native';

import type { Narrator } from './Narrator';

export class ScreenReaderNarrator implements Narrator {
  private readonly listeners = new Set<() => void>();
  private current: string | null = null;

  constructor() {
    AccessibilityInfo.addEventListener('announcementFinished', ({ announcement, success }) => {
      if (announcement !== this.current) return;
      this.current = null;
      if (success) this.listeners.forEach((listener) => listener());
    });
  }

  speak(text: string): void {
    this.current = text;
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: false });
  }

  stop(): void {
    this.current = null;
  }

  speaking(): boolean {
    return this.current !== null;
  }

  onDone(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
