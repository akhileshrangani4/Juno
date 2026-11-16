import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, type } from '@/theme';

// Wait before the buttons take a tap, so a touch already on its way when the question appears can't answer it.
export const CONSENT_ARM_MS = 800;

// The descriptions question on screen, for someone not running VoiceOver. A tap on a named button is a deliberate
// answer; a tap anywhere else on the camera only repeats the question. Placed in the upper middle, away from the
// bottom half where the shutter is.
export function ConsentButtons({ onAnswer }: { onAnswer(answer: 'yes' | 'no'): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), CONSENT_ARM_MS);
    return () => clearTimeout(timer);
  }, []);
  const answer = (value: 'yes' | 'no') => () => {
    if (armed) onAnswer(value);
  };
  return (
    <View style={styles.box} pointerEvents="box-none">
      <Pressable
        style={[styles.button, styles.allow]}
        accessibilityRole="button"
        accessibilityLabel="Allow descriptions"
        accessibilityHint="Sends pictures to OpenAI to be described."
        onPress={answer('yes')}>
        <Text style={[styles.label, styles.allowLabel]} maxFontSizeMultiplier={type.maxScale}>
          Allow descriptions
        </Text>
      </Pressable>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Keep pictures on my phone"
        accessibilityHint="Pictures stay on your phone. Framing help still works."
        onPress={answer('no')}>
        <Text style={styles.label} maxFontSizeMultiplier={type.maxScale}>
          Keep pictures on my phone
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: '14%', left: 24, right: 24, gap: 16 },
  button: { minHeight: 72, borderRadius: 16, borderWidth: 4, borderColor: colors.focus, backgroundColor: '#000', justifyContent: 'center', padding: 14 },
  allow: { backgroundColor: colors.focus },
  label: { color: colors.text, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
  allowLabel: { color: '#000' },
});
