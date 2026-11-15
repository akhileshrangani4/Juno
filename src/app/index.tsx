import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { Intro } from '@/screens/Intro';
import { MainScreen } from '@/screens/MainScreen';
import { useSession } from '@/session/SessionContext';
import { colors } from '@/theme';

export default function Home() {
  const { ready, onboarded, account, guest, completeOnboarding } = useSession();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  if (!onboarded) return <Intro onDone={completeOnboarding} />;
  if (!account && !guest) return <Redirect href="/sign-in" />;
  return <MainScreen key={account?.id ?? 'guest'} />;
}
