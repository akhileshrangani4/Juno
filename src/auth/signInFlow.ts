import type { SignInResult, SocialAccount } from '@/social/types';

import { normalizeHandle } from './handle';
import { authMessages } from './messages';

export type SignInFlow =
  | { step: 'entry'; entry: string; message: string; error: boolean }
  | { step: 'checking'; entry: string; handle: string; addedDomain: boolean; message: string }
  | { step: 'confirm'; entry: string; handle: string; addedDomain: boolean; message: string; error: boolean }
  | { step: 'opening'; entry: string; handle: string; addedDomain: boolean; message: string }
  | { step: 'signedIn'; account: SocialAccount; message: string };

export type SignInEvent =
  | { type: 'edit'; entry: string }
  | { type: 'submit' }
  | { type: 'found' }
  | { type: 'notFound' }
  | { type: 'lookupFailed' }
  | { type: 'confirm' }
  | { type: 'change' }
  | { type: 'result'; result: SignInResult };

export function startSignIn(entry: string, screenReader: boolean): SignInFlow {
  return { step: 'entry', entry, message: authMessages.handlePrompt(screenReader), error: false };
}

export function nextSignIn(state: SignInFlow, event: SignInEvent, screenReader: boolean): SignInFlow {
  if (state.step === 'signedIn') return state;
  const entryWith = (message: string, error = true): SignInFlow => ({ step: 'entry', entry: state.entry, message, error });
  switch (event.type) {
    case 'edit':
      return state.step === 'entry' ? { ...state, entry: event.entry } : state;
    case 'change':
      return startSignIn(state.entry, screenReader);
    case 'submit': {
      if (state.step !== 'entry') return state;
      if (!state.entry.trim()) return entryWith(authMessages.emptyHandle);
      const normalized = normalizeHandle(state.entry);
      if (!normalized) return entryWith(authMessages.invalidHandle);
      return { step: 'checking', entry: state.entry, ...normalized, message: authMessages.checking(normalized.handle) };
    }
    case 'found':
      if (state.step !== 'checking') return state;
      return { ...state, step: 'confirm', message: authMessages.readBack(state.handle, state.addedDomain, screenReader), error: false };
    case 'notFound':
      return state.step === 'checking' ? entryWith(authMessages.notFound(state.handle)) : state;
    case 'lookupFailed':
      return state.step === 'checking' ? entryWith(authMessages.lookupFailed) : state;
    case 'confirm':
      if (state.step !== 'confirm') return state;
      return { step: 'opening', entry: state.entry, handle: state.handle, addedDomain: state.addedDomain, message: authMessages.opening };
    case 'result': {
      if (state.step !== 'opening') return state;
      const { result } = event;
      if (result.status === 'success') return { step: 'signedIn', account: result.account, message: authMessages.signedIn(result.account) };
      const message =
        result.status === 'cancelled' ? authMessages.cancelled(screenReader) : result.reason === 'network' ? authMessages.networkFailure : authMessages.serverFailure;
      return { ...state, step: 'confirm', message, error: result.status === 'failed' };
    }
  }
}
