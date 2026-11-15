export type CommentsController = {
  open(): boolean;
  close(): boolean;
  read(postUri: string): Promise<string[]>;
  loaded(postUri: string): string[] | null;
};

let controller: CommentsController | null = null;

export function registerCommentsController(next: CommentsController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function openFocusedPostComments(): boolean {
  return controller?.open() ?? false;
}

export function closeComments(): boolean {
  return controller?.close() ?? false;
}

export function loadedComments(postUri: string): string[] | null {
  return controller?.loaded(postUri) ?? null;
}

export function readComments(postUri: string): Promise<string[]> {
  return controller?.read(postUri) ?? Promise.resolve([]);
}
