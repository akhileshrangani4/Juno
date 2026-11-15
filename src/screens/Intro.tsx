import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenReader } from '@/accessibility/useScreenReader';
import { haptic } from '@/feedback/haptics';
import { INTRO_SUMMARY, introInstructions } from '@/narration/buildNarration';
import { useNarrator } from '@/narration/useNarrator';
import { PracticeScreen } from '@/onboarding/PracticeScreen';
import { colors, type } from '@/theme';

export function Intro({ onDone }: { onDone(): void }) {
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const instructions = introInstructions(screenReader);
  const [practicing, setPracticing] = useState(false);

  useEffect(() => {
    if (screenReader) return;
    narrator.speak(`${INTRO_SUMMARY} ${instructions}`);
    return () => narrator.stop();
  }, [narrator, screenReader, instructions]);

  if (practicing) return <PracticeScreen onDone={onDone} />;

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={INTRO_SUMMARY}
        accessibilityHint={instructions}
        onPress={() => {
          haptic('next');
          setPracticing(true);
        }}>
        <Text style={styles.title} accessibilityRole="header">
          Welcome
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={type.maxScale}>
          {INTRO_SUMMARY} {instructions}
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
