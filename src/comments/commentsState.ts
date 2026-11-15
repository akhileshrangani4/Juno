import type { Reply } from '@/social/types';

export type Thread = { status: 'loading' | 'ready'; replies: Reply[]; index: number };

export type CommentsState = { open: string | null; threads: Record<string, Thread> };

export type CommentsAction =
  | { type: 'open'; postUri: string }
  | { type: 'loaded'; postUri: string; replies: Reply[] }
  | { type: 'failed'; postUri: string }
  | { type: 'moved'; index: number }
  | { type: 'close' };

export type ReplyMoveOutcome = 'moved' | 'atStart' | 'atEnd' | 'loading';

export const initialCommentsState: CommentsState = { open: null, threads: {} };

export function commentsReducer(state: CommentsState, action: CommentsAction): CommentsState {
  switch (action.type) {
    case 'open':
      return {
        open: action.postUri,
        threads: state.threads[action.postUri] ? state.threads : { ...state.threads, [action.postUri]: { status: 'loading', replies: [], index: 0 } },
      };
    case 'loaded': {
      const existing = state.threads[action.postUri];
      if (existing?.status === 'ready') return state;
      return { ...state, threads: { ...state.threads, [action.postUri]: { status: 'ready', replies: action.replies, index: 0 } } };
    }
    case 'failed': {
      const { [action.postUri]: _dropped, ...threads } = state.threads;
      return { open: state.open === action.postUri ? null : state.open, threads };
    }
    case 'moved': {
      const thread = state.open ? state.threads[state.open] : undefined;
      if (!state.open || !thread) return state;
      return { ...state, threads: { ...state.threads, [state.open]: { ...thread, index: action.index } } };
    }
    case 'close':
      return { ...state, open: null };
  }
}

export function openThread(state: CommentsState): Thread | null {
  return state.open ? (state.threads[state.open] ?? null) : null;
}

export function moveReply(thread: Thread, direction: 'next' | 'previous'): { index: number; outcome: ReplyMoveOutcome } {
  if (thread.status === 'loading') return { index: thread.index, outcome: 'loading' };
  if (direction === 'previous') return thread.index === 0 ? { index: 0, outcome: 'atStart' } : { index: thread.index - 1, outcome: 'moved' };
  return thread.index < thread.replies.length - 1 ? { index: thread.index + 1, outcome: 'moved' } : { index: thread.index, outcome: 'atEnd' };
}
