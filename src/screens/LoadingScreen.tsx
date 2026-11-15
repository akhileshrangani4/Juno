import * as Speech from 'expo-speech';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { colors, type } from '@/theme';

const ANNOUNCE_AFTER_MS = 700;

export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  useEffect(() => {
    let spoke = false;
    const timer = setTimeout(() => {
      AccessibilityInfo.isScreenReaderEnabled().then(
        (screenReader) => {
          if (screenReader) return AccessibilityInfo.announceForAccessibility(label);
          spoke = true;
          Speech.speak(label);
        },
        () => undefined,
      );
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
      if (spoke) void Speech.stop();
    };
  }, [label]);

  return (
    <View style={styles.screen} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <Text style={styles.text} maxFontSizeMultiplier={type.maxScale}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontSize: type.body, fontWeight: '700' },
});
