import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';

import { Intro } from '@/screens/Intro';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { MainScreen } from '@/screens/MainScreen';
import { SessionUnreachable } from '@/screens/SessionUnreachable';
import { useSession } from '@/session/SessionContext';

export default function Home() {
  const { ready, connecting, unreachable, onboarded, account, guest, expiredAccount, provider, completeOnboarding } = useSession();
  const signedInElsewhere = !!account || guest;
  useEffect(() => {
    if (expiredAccount && signedInElsewhere) router.push('/sign-in');
  }, [expiredAccount, signedInElsewhere]);
  if (!ready) return <LoadingScreen label={connecting ? `Still connecting to ${provider.name}` : undefined} />;
  if (!onboarded) return <Intro onDone={completeOnboarding} />;
  if (unreachable) return <SessionUnreachable />;
  if (!account && !guest) return <Redirect href="/sign-in" />;
  return <MainScreen key={account?.id ?? 'guest'} />;
}
