import type { Post, PostRef } from '@/social/types';

// live: false once the action can no longer be undone from here (a draft that was sent or thrown away); undo passes
// over such entries. remains: what to tell the user if undo stopped something older and left this one in place.
// published: a post or reply that went out; undo never deletes it directly, it offers the delete read-back for it
// (and the rest of its thread).
export type UndoEntry = {
  label: string;
  undo(): Promise<string>;
  live?: () => boolean;
  remains?: string;
  published?: { post: Post; rest: PostRef[] };
};

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

  // Puts what an action became (a sent post for its draft) where the action was, keeping its place in the order.
  replace(entry: UndoEntry, next: UndoEntry): void {
    const at = this.entries.indexOf(entry);
    if (at < 0) return this.push(next);
    this.entries[at] = next;
  }

  // The actions after this one that can still be undone, newest first.
  newerThan(entry: UndoEntry): UndoEntry[] {
    const at = this.entries.indexOf(entry);
    if (at < 0) return [];
    return this.entries
      .slice(at + 1)
      .filter((newer) => newer.live?.() !== false)
      .reverse();
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
