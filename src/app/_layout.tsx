import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScreenReaderProvider } from '@/accessibility/useScreenReader';
import { BackendProvider } from '@/backend/convex';
import { SessionProvider } from '@/session/SessionContext';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ScreenReaderProvider>
          <BackendProvider>
            <SessionProvider>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: styles.root }} />
            </SessionProvider>
          </BackendProvider>
        </ScreenReaderProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background } });
