import { useEffect, useState } from 'react';

import { useScreenReader } from '@/accessibility/useScreenReader';
import { spellHandle } from '@/auth/handle';
import { nextSignIn, startSignIn, type SignInEvent, type SignInFlow } from '@/auth/signInFlow';
import { haptic } from '@/feedback/haptics';
import { useNarrator } from '@/narration/useNarrator';
import { useSession } from '@/session/SessionContext';
import type { SocialAccount } from '@/social/types';

import { AuthButton, AuthScreen, Field, Heading, Status, afterSpeech, useStatus } from './AuthControls';

const OPEN_AFTER_MAX_MS = 8000;

export function HandleSignIn({
  initialHandle,
  onSignedIn,
  onAppPassword,
  onBack,
}: {
  initialHandle: string;
  onSignedIn(account: SocialAccount, message: string): void;
  onAppPassword(handle: string): void;
  onBack(): void;
}) {
  const { provider, signIn } = useSession();
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const [flow, setFlow] = useState<SignInFlow>(() => startSignIn(initialHandle, screenReader));
  const dispatch = (event: SignInEvent) => setFlow((current) => nextSignIn(current, event, screenReader));
  const statusRef = useStatus(flow.step === 'signedIn' ? '' : flow.message, { speakOnly: flow.step === 'opening' });
  const error = (flow.step === 'entry' || flow.step === 'confirm') && flow.error;

  useEffect(() => {
    if (error) haptic('edge');
  }, [error, flow.message]);

  useEffect(() => {
    if (flow.step !== 'checking') return;
    let current = true;
    provider.findAccount(flow.handle).then(
      (found) => current && dispatch({ type: found ? 'found' : 'notFound' }),
      () => current && dispatch({ type: 'lookupFailed' }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step, provider]);

  useEffect(() => {
    if (flow.step !== 'opening') return;
    let current = true;
    void afterSpeech(narrator, OPEN_AFTER_MAX_MS)
      .then(() => signIn(flow.handle))
      .then((result) => current && dispatch({ type: 'result', result }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step]);

  useEffect(() => {
    if (flow.step === 'signedIn') onSignedIn(flow.account, flow.message);
  }, [flow, onSignedIn]);

  if (flow.step === 'signedIn') return null;
  const handle = flow.step === 'entry' ? '' : flow.handle;
  const appPassword = (
    <AuthButton
      label="Use an app password instead"
      hint="Sign in with an app password from Bluesky settings, if signing in on Bluesky's page doesn't work."
      onPress={() => onAppPassword(handle || flow.entry)}
    />
  );
  const back = <AuthButton label="Back" hint="Returns to the first screen." onPress={onBack} />;

  return (
    <AuthScreen onEscape={flow.step === 'entry' ? onBack : () => dispatch({ type: 'change' })}>
      <Heading>Sign in</Heading>
      <Status message={flow.message} error={error} statusRef={statusRef} />
      {flow.step === 'entry' ? (
        <>
          <Field
            label="Bluesky handle"
            nativeID="handle-label"
            accessibilityHint="For example maya dot bsky dot social. You can type it or dictate it with the keyboard's microphone."
            value={flow.entry}
            onChangeText={(entry) => dispatch({ type: 'edit', entry })}
            placeholder="maya.bsky.social"
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => dispatch({ type: 'submit' })}
          />
          <AuthButton label="Continue" hint="Checks your handle and reads it back to you." onPress={() => dispatch({ type: 'submit' })} primary />
          {appPassword}
          {back}
        </>
      ) : (
        <>
          <AuthButton
            label={flow.step === 'checking' ? 'Checking' : flow.step === 'opening' ? 'Opening Bluesky' : 'Continue'}
            hint={`Opens Bluesky's sign-in page for ${spellHandle(flow.handle)}. You enter your password there, not in Juno.`}
            onPress={() => dispatch({ type: 'confirm' })}
            busy={flow.step !== 'confirm'}
            primary
          />
          <AuthButton label="Change handle" hint="Go back and edit the handle you entered." onPress={() => dispatch({ type: 'change' })} busy={flow.step === 'opening'} />
          {appPassword}
          {back}
        </>
      )}
    </AuthScreen>
  );
}
