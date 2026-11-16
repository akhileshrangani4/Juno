import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/accessibility/ScaledText';
import { useScreenReader } from '@/accessibility/useScreenReader';
import type { Narrator } from '@/narration/Narrator';
import { useNarrator } from '@/narration/useNarrator';
import { colors, type } from '@/theme';

const FOCUS_DELAY_MS = 250;

export function useStatus(message: string, { speakOnly = false, key = '' } = {}) {
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!message) return;
    if (!screenReader || speakOnly) {
      narrator.speak(message);
      return;
    }
    const timer = setTimeout(() => {
      if (ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, 'focus');
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [message, key, narrator, screenReader, speakOnly]);
  return ref;
}

export function afterSpeech(narrator: Narrator, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, maxMs);
    const unsubscribe = narrator.onDone(done);
    function done() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

export function AuthScreen({ children, onEscape }: { children: ReactNode; onEscape?(): void }) {
  return (
    <SafeAreaView style={styles.screen} onAccessibilityEscape={onEscape}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: string }) {
  return (
    <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={type.maxScale}>
      {children}
    </Text>
  );
}

export function Status({ message, error, statusRef }: { message: string; error?: boolean; statusRef: React.RefObject<ComponentRef<typeof Text> | null> }) {
  return (
    <Text
      ref={statusRef}
      style={[styles.status, error && styles.error]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      maxFontSizeMultiplier={type.maxScale}>
      {message}
    </Text>
  );
}

export function AuthButton({
  label,
  hint,
  onPress,
  primary,
  busy,
}: {
  label: string;
  hint: string;
  onPress(): void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, primary && styles.primary, busy && styles.busy]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      disabled={busy}
      onPress={onPress}>
      <Text style={[styles.buttonText, primary && styles.primaryText]} maxFontSizeMultiplier={type.maxScale}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({ label, nativeID, ...input }: TextInputProps & { label: string; nativeID: string; ref?: React.Ref<ComponentRef<typeof TextInput>> }) {
  return (
    <>
      <Text style={styles.label} nativeID={nativeID} maxFontSizeMultiplier={type.maxScale}>
        {label}
      </Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={label}
        accessibilityLabelledBy={nativeID}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        maxFontSizeMultiplier={type.maxScale}
        {...input}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 14, flexGrow: 1, justifyContent: 'center' },
  title: { color: colors.focus, fontSize: 36, fontWeight: '800' },
  status: { color: colors.text, fontSize: type.title, lineHeight: 36, fontWeight: '600', marginBottom: 6 },
  error: { color: colors.danger, fontWeight: '700' },
  label: { color: colors.text, fontSize: type.title, fontWeight: '700' },
  input: { color: colors.text, fontSize: type.title, fontWeight: '600', borderWidth: 3, borderColor: colors.text, borderRadius: 14, padding: 16, minHeight: 64 },
  button: { minHeight: 72, borderRadius: 16, borderWidth: 3, borderColor: colors.focus, alignItems: 'center', justifyContent: 'center', padding: 14 },
  primary: { backgroundColor: colors.focus },
  busy: { opacity: 0.6 },
  buttonText: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
  primaryText: { color: colors.onFocus },
});
