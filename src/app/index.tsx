import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';

import { Intro } from '@/screens/Intro';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { MainScreen } from '@/screens/MainScreen';
import { useSession } from '@/session/SessionContext';

export default function Home() {
  const { ready, connecting, onboarded, account, guest, expiredAccount, provider, completeOnboarding } = useSession();
  useEffect(() => {
    if (expiredAccount) router.push('/sign-in');
  }, [expiredAccount]);
  if (!ready) return <LoadingScreen label={connecting ? `Still connecting to ${provider.name}` : undefined} />;
  if (!onboarded) return <Intro onDone={completeOnboarding} />;
  if (!account && !guest) return <Redirect href="/sign-in" />;
  return <MainScreen key={account?.id ?? 'guest'} />;
}
