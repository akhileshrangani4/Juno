import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { recordUser } from '@/backend/convex';
import { createSocialProvider, type RestoreResult, type SignInResult, type SocialAccount, type SocialProvider } from '@/social';
import { secureStore } from '@/storage/keyValueStore';

import { GUEST_KEY, signOut } from './signOut';
import { withTimeout } from './withTimeout';

const ONBOARDED_KEY = 'app.onboarded';
const STARTUP_TIMEOUT_MS = 4000;
export const RESTORE_TIMEOUT_MS = 20000;
const UNREACHABLE: RestoreResult = { status: 'unreachable' };

type Session = {
  ready: boolean;
  connecting: boolean;
  unreachable: boolean;
  retrying: boolean;
  restoreAttempt: number;
  onboarded: boolean;
  guest: boolean;
  account: SocialAccount | null;
  expiredAccount: SocialAccount | null;
  provider: SocialProvider;
  signIn(handle: string): Promise<SignInResult>;
  createAccount(): Promise<SignInResult>;
  signInWithAppPassword(identifier: string, appPassword: string): Promise<SocialAccount>;
  signOut(): Promise<void>;
  continueAsGuest(): Promise<void>;
  retryRestore(): Promise<void>;
  listenForNow(): void;
  completeOnboarding(): void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children, provider: injected }: { children: ReactNode; provider?: SocialProvider }) {
  const [provider] = useState(() => injected ?? createSocialProvider());
  const [state, setState] = useState({
    ready: false,
    connecting: false,
    unreachable: false,
    retrying: false,
    restoreAttempt: 0,
    onboarded: false,
    guest: false,
    account: null as SocialAccount | null,
    expiredAccount: null as SocialAccount | null,
  });

  useEffect(() => provider.onSessionExpired((expiredAccount) => setState((current) => ({ ...current, expiredAccount }))), [provider]);

  const mounted = useRef(true);

  const restore = useCallback(async () => {
    const result = await withTimeout(provider.restoreSession().catch(() => UNREACHABLE), RESTORE_TIMEOUT_MS, UNREACHABLE);
    if (!mounted.current) return;
    if (result.status === 'restored') recordUser(provider.id, result.account);
    setState((current) => ({
      ...current,
      ready: true,
      connecting: false,
      retrying: false,
      unreachable: result.status === 'unreachable',
      restoreAttempt: current.restoreAttempt + 1,
      account: result.status === 'restored' ? result.account : null,
      expiredAccount: result.status === 'invalid' ? result.account : current.expiredAccount,
    }));
  }, [provider]);

  useEffect(() => {
    mounted.current = true;
    const read = (key: string) =>
      withTimeout(
        secureStore.get(key).catch((error: unknown) => {
          console.warn(`Could not read ${key} from secure storage`, error);
          return null;
        }),
        STARTUP_TIMEOUT_MS,
        null,
      );
    let slow: ReturnType<typeof setTimeout> | undefined;
    const stored = withTimeout(
      provider.hasStoredSession().catch(() => false),
      STARTUP_TIMEOUT_MS,
      false,
    );
    Promise.all([stored, read(ONBOARDED_KEY), read(GUEST_KEY)]).then(async ([hasSession, onboarded, guest]) => {
      if (!mounted.current) return;
      const saved = { onboarded: onboarded === '1', guest: guest === '1' };
      if (!hasSession) return setState((current) => ({ ...current, ...saved, ready: true, connecting: false, account: null }));
      setState((current) => ({ ...current, ...saved }));
      slow = setTimeout(() => setState((current) => ({ ...current, connecting: true })), STARTUP_TIMEOUT_MS);
      await restore();
      clearTimeout(slow);
    });
    return () => {
      mounted.current = false;
      clearTimeout(slow);
    };
  }, [provider, restore]);

  const adoptResult = (result: SignInResult): SignInResult => {
    if (result.status !== 'success') return result;
    recordUser(provider.id, result.account);
    setState((current) => ({ ...current, account: result.account, expiredAccount: null }));
    return result;
  };

  const session: Session = {
    ...state,
    provider,
    signIn: async (handle) => adoptResult(await provider.signIn(handle)),
    createAccount: async () => adoptResult(await provider.createAccount()),
    signInWithAppPassword: async (identifier, appPassword) => {
      const account = await provider.signInWithAppPassword(identifier, appPassword);
      adoptResult({ status: 'success', account });
      return account;
    },
    signOut: async () => {
      await signOut(provider, secureStore);
      setState((current) => ({ ...current, account: null, expiredAccount: null, guest: false }));
    },
    continueAsGuest: async () => {
      if (state.account) await provider.signOut();
      void secureStore.set(GUEST_KEY, '1');
      setState((current) => ({ ...current, account: null, expiredAccount: null, guest: true }));
    },
    retryRestore: async () => {
      setState((current) => ({ ...current, retrying: true }));
      await restore();
    },
    listenForNow: () => setState((current) => ({ ...current, unreachable: false, guest: true })),
    completeOnboarding: () => {
      void secureStore.set(ONBOARDED_KEY, '1');
      setState((current) => ({ ...current, onboarded: true }));
    },
  };

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
