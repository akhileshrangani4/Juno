export type UndoEntry = { label: string; undo(): Promise<string> };

// Everything the user did that "undo" can reverse, newest last. There is one for the whole app session and every way
// of acting writes to it, gesture or voice, with or without a call, so "undo" always reverses the user's most recent
// action. It belongs to the signed-in account and is cleared with the rest of the viewer's state.
export class ActionHistory {
  private entries: UndoEntry[] = [];

  push(entry: UndoEntry): void {
    this.entries.push(entry);
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }

  // Takes back an entry for an action that turned out to do nothing, wherever it is by now.
  remove(entry: UndoEntry): void {
    this.entries = this.entries.filter((candidate) => candidate !== entry);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

export const actionHistory = new ActionHistory();
