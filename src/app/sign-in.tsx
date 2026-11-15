import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenReader } from '@/accessibility/useScreenReader';
import { haptic } from '@/feedback/haptics';
import { useNarrator } from '@/narration/useNarrator';
import { returnToFeed } from '@/session/returnToFeed';
import { useSession } from '@/session/SessionContext';
import { colors, type } from '@/theme';

const SPOKEN_INTRO =
  'Sign in to Bluesky. There are two text fields, your handle and your app password, followed by a sign in button and a button to continue without signing in. Turn on VoiceOver or TalkBack to fill in the fields.';

export default function SignIn() {
  const { account, provider, signIn, signOut, continueAsGuest } = useSession();
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) narrator.speak(screenReader ? `Sign in to ${provider.name}.` : SPOKEN_INTRO);
    return () => narrator.stop();
  }, [narrator, screenReader, account, provider]);

  const fail = (message: string) => {
    haptic('edge');
    setError(message);
    narrator.speak(message);
  };

  const submit = async () => {
    if (busy) return;
    if (!handle.trim() || !password) return fail('Enter your handle and your app password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(handle, password);
      haptic('next');
      returnToFeed();
    } catch {
      fail(`Could not sign in to ${provider.name}. Check your handle and app password, then try again.`);
    } finally {
      setBusy(false);
    }
  };

  const leave = (action?: () => void | Promise<void>) => async () => {
    haptic('next');
    await action?.();
    returnToFeed();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            {account ? 'Account' : `Sign in to ${provider.name}`}
          </Text>
          {account ? (
            <>
              <Text style={styles.body}>Signed in as @{account.handle}</Text>
              <Button label="Back to the feed" hint="Returns to your timeline." onPress={leave()} primary />
              <Button label="Sign out" hint={`Signs out of ${provider.name} on this device.`} onPress={leave(signOut)} />
            </>
          ) : (
            <>
              <Text style={styles.label} nativeID="handle-label">
                Handle
              </Text>
              <TextInput
                style={styles.input}
                value={handle}
                onChangeText={setHandle}
                accessibilityLabel="Handle"
                accessibilityHint="Your Bluesky handle, for example alice dot bsky dot social."
                accessibilityLabelledBy="handle-label"
                placeholder="alice.bsky.social"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => passwordInput.current?.focus()}
                maxFontSizeMultiplier={type.maxScale}
              />
              <Text style={styles.label} nativeID="password-label">
                App password
              </Text>
              <TextInput
                ref={passwordInput}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="App password"
                accessibilityHint="An app password created in Bluesky settings under Privacy and security. Not your main password."
                accessibilityLabelledBy="password-label"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                maxFontSizeMultiplier={type.maxScale}
              />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                  {error}
                </Text>
              ) : null}
              <Button label={busy ? 'Signing in' : 'Sign in'} hint="Signs in and opens your timeline." onPress={submit} disabled={busy} primary />
              <Button
                label="Continue without signing in"
                hint="Opens a public demo feed. You can sign in later from the agent screen."
                onPress={leave(continueAsGuest)}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Button({ label, hint, onPress, primary, disabled }: { label: string; hint: string; onPress(): void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      style={[styles.button, primary && styles.primary]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, busy: !!disabled }}
      disabled={disabled}
      onPress={onPress}>
      <Text style={[styles.buttonText, primary && { color: colors.onFocus }]} maxFontSizeMultiplier={type.maxScale}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 14, flexGrow: 1, justifyContent: 'center' },
  title: { color: colors.focus, fontSize: 36, fontWeight: '800', marginBottom: 8 },
  body: { color: colors.text, fontSize: type.title, fontWeight: '600' },
  label: { color: colors.text, fontSize: type.title, fontWeight: '700' },
  input: { color: colors.text, fontSize: type.title, fontWeight: '600', borderWidth: 3, borderColor: colors.text, borderRadius: 14, padding: 16, minHeight: 64 },
  error: { color: colors.danger, fontSize: type.title, fontWeight: '700' },
  button: { minHeight: 72, borderRadius: 16, borderWidth: 3, borderColor: colors.focus, alignItems: 'center', justifyContent: 'center', padding: 14 },
  primary: { backgroundColor: colors.focus },
  buttonText: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
});
