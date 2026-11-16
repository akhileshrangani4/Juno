import * as Speech from 'expo-speech';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Text } from '@/accessibility/ScaledText';
import { colors, type } from '@/theme';

const ANNOUNCE_AFTER_MS = 700;

const announced = new Set<string>();

export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  useEffect(() => {
    if (announced.has(label)) return;
    const timer = setTimeout(() => {
      announced.add(label);
      AccessibilityInfo.isScreenReaderEnabled().then(
        (screenReader) => (screenReader ? AccessibilityInfo.announceForAccessibility(label) : Speech.speak(label)),
        () => undefined,
      );
    }, ANNOUNCE_AFTER_MS);
    return () => clearTimeout(timer);
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
