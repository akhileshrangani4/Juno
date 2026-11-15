import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { recordUser } from '@/backend/convex';
import { createSocialProvider, type SocialAccount, type SocialProvider } from '@/social';
import { secureStore } from '@/storage/keyValueStore';

import { withTimeout } from './withTimeout';

const ONBOARDED_KEY = 'app.onboarded';
const GUEST_KEY = 'app.guest';
const STARTUP_TIMEOUT_MS = 4000;

type Session = {
  ready: boolean;
  onboarded: boolean;
  guest: boolean;
  account: SocialAccount | null;
  provider: SocialProvider;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  continueAsGuest(): void;
  completeOnboarding(): void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children, provider: injected }: { children: ReactNode; provider?: SocialProvider }) {
  const [provider] = useState(() => injected ?? createSocialProvider());
  const [state, setState] = useState({ ready: false, onboarded: false, guest: false, account: null as SocialAccount | null });

  useEffect(() => {
    let mounted = true;
    const read = (key: string) =>
      withTimeout(
        secureStore.get(key).catch((error: unknown) => {
          console.warn(`Could not read ${key} from secure storage`, error);
          return null;
        }),
        STARTUP_TIMEOUT_MS,
        null,
      );
    const restore = provider.restoreSession().catch(() => null);
    const adopt = (account: SocialAccount | null) => {
      if (!mounted || !account) return;
      recordUser(provider.id, account);
      setState((current) => ({ ...current, account }));
    };
    Promise.all([withTimeout(restore, STARTUP_TIMEOUT_MS, undefined), read(ONBOARDED_KEY), read(GUEST_KEY)]).then(([account, onboarded, guest]) => {
      if (!mounted) return;
      setState({ ready: true, onboarded: onboarded === '1', guest: guest === '1', account: null });
      if (account === undefined) restore.then(adopt);
      else adopt(account);
    });
    return () => {
      mounted = false;
    };
  }, [provider]);

  const session: Session = {
    ...state,
    provider,
    signIn: async (identifier, password) => {
      const account = await provider.signIn(identifier, password);
      recordUser(provider.id, account);
      setState((current) => ({ ...current, account }));
    },
    signOut: async () => {
      await provider.signOut().catch(() => undefined);
      await secureStore.remove(GUEST_KEY);
      setState((current) => ({ ...current, account: null, guest: false }));
    },
    continueAsGuest: () => {
      void secureStore.set(GUEST_KEY, '1');
      setState((current) => ({ ...current, guest: true }));
    },
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
