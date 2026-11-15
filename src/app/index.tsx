import { Redirect } from 'expo-router';

import { Intro } from '@/screens/Intro';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { MainScreen } from '@/screens/MainScreen';
import { useSession } from '@/session/SessionContext';

export default function Home() {
  const { ready, onboarded, account, guest, completeOnboarding } = useSession();
  if (!ready) return <LoadingScreen />;
  if (!onboarded) return <Intro onDone={completeOnboarding} />;
  if (!account && !guest) return <Redirect href="/sign-in" />;
  return <MainScreen key={account?.id ?? 'guest'} />;
}
