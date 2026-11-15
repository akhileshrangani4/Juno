import { useRef, useState, type ComponentRef } from 'react';
import { TextInput } from 'react-native';

import { looksLikeAppPassword, authMessages } from '@/auth/messages';
import { haptic } from '@/feedback/haptics';
import { useSession } from '@/session/SessionContext';
import type { SocialAccount } from '@/social/types';

import { AuthButton, AuthScreen, Field, Heading, Status, useStatus } from './AuthControls';

export function AppPasswordSignIn({
  initialHandle,
  onSignedIn,
  onBack,
}: {
  initialHandle: string;
  onSignedIn(account: SocialAccount, message: string): void;
  onBack(): void;
}) {
  const { signInWithAppPassword } = useSession();
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [handle, setHandle] = useState(initialHandle);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ message: authMessages.appPasswordPrompt, error: false });
  const statusRef = useStatus(status.message);

  const fail = (message: string) => {
    haptic('edge');
    setStatus({ message, error: true });
  };

  const submit = async () => {
    if (busy) return;
    if (!handle.trim() || !password) return fail(authMessages.appPasswordMissing);
    if (!looksLikeAppPassword(password)) return fail(authMessages.notAnAppPassword);
    setBusy(true);
    try {
      const account = await signInWithAppPassword(handle, password.trim());
      setPassword('');
      onSignedIn(account, authMessages.signedIn(account));
    } catch {
      fail(authMessages.appPasswordFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen onEscape={onBack}>
      <Heading>App password</Heading>
      <Status message={status.message} error={status.error} statusRef={statusRef} />
      <Field
        label="Handle"
        nativeID="app-password-handle-label"
        accessibilityHint="Your Bluesky handle, for example maya dot bsky dot social."
        value={handle}
        onChangeText={setHandle}
        placeholder="maya.bsky.social"
        autoComplete="username"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordInput.current?.focus()}
      />
      <Field
        ref={passwordInput}
        label="App password"
        nativeID="app-password-label"
        accessibilityHint="An app password created in Bluesky settings under Privacy and security. Not your main password."
        value={password}
        onChangeText={setPassword}
        placeholder="xxxx-xxxx-xxxx-xxxx"
        secureTextEntry
        autoComplete="off"
        textContentType="none"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <AuthButton label={busy ? 'Signing in' : 'Sign in'} hint="Signs in with the app password and opens your timeline." onPress={submit} busy={busy} primary />
      <AuthButton label="Back" hint="Returns to signing in with your handle on Bluesky's page." onPress={onBack} />
    </AuthScreen>
  );
}
