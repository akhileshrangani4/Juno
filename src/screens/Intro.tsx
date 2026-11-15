import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptic } from '@/feedback/haptics';
import { messages } from '@/narration/buildNarration';
import { useNarrator } from '@/narration/useNarrator';
import { colors, type } from '@/theme';

export function Intro({ onDone }: { onDone(): void }) {
  const narrator = useNarrator();

  useEffect(() => {
    narrator.speak(messages.intro);
    return () => narrator.stop();
  }, [narrator]);

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Welcome. Continue"
        accessibilityHint="Double tap to continue to sign in."
        onPress={() => {
          haptic('next');
          onDone();
        }}>
        <Text style={styles.title} accessibilityRole="header">
          Welcome
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={type.maxScale}>
          {messages.intro}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  button: { flex: 1, margin: 12, padding: 20, gap: 16, justifyContent: 'center', borderWidth: 6, borderColor: colors.focus, borderRadius: 24 },
  title: { color: colors.focus, fontSize: 40, fontWeight: '800' },
  body: { color: colors.text, fontSize: 24, lineHeight: 34, fontWeight: '600' },
});
