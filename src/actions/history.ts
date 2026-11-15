// live: false once the action can no longer be undone from here (a draft that was sent or thrown away); undo passes
// over such entries.
export type UndoEntry = { label: string; undo(): Promise<string>; live?: () => boolean };

// Everything the user did that "undo" can reverse, newest last. There is one for the whole app session and every way
// of acting writes to it, gesture or voice, with or without a call, so "undo" always reverses the user's most recent
// action. It belongs to the signed-in account and is cleared with the rest of the viewer's state.
export class ActionHistory {
  private entries: UndoEntry[] = [];
  private readonly listeners = new Set<(text: string) => void>();

  push(entry: UndoEntry): void {
    this.entries.push(entry);
  }

  // The user's most recent action that can still be undone.
  pop(): UndoEntry | undefined {
    for (let entry = this.entries.pop(); entry; entry = this.entries.pop()) {
      if (entry.live?.() !== false) return entry;
    }
    return undefined;
  }

  // Puts an entry back on top, as the most recent action, wherever it was.
  touch(entry: UndoEntry): void {
    this.remove(entry);
    this.push(entry);
  }

  // Takes back an entry for an action that turned out to do nothing, wherever it is by now.
  remove(entry: UndoEntry): void {
    this.entries = this.entries.filter((candidate) => candidate !== entry);
  }

  // Something about an earlier action the user must hear, such as an undo that failed once Bluesky answered. The
  // screen says it the way it says a failed like.
  tell(text: string): void {
    this.listeners.forEach((listener) => listener(text));
  }

  onTell(listener: (text: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.filter((entry) => entry.live?.() !== false).length;
  }
}

export const actionHistory = new ActionHistory();
