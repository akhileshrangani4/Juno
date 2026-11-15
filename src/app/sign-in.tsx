import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { APP_NAME } from '@/appName';
import { authMessages } from '@/auth/messages';
import { haptic } from '@/feedback/haptics';
import { useNarrator } from '@/narration/useNarrator';
import { AppPasswordSignIn } from '@/screens/auth/AppPasswordSignIn';
import { AuthButton, AuthScreen, Heading, Status, afterSpeech, useStatus } from '@/screens/auth/AuthControls';
import { HandleSignIn } from '@/screens/auth/HandleSignIn';
import { returnToFeed } from '@/session/returnToFeed';
import { useSession } from '@/session/SessionContext';
import type { SignInResult, SocialAccount } from '@/social/types';

type Mode = 'choices' | 'handle' | 'appPassword' | 'create' | 'account' | 'confirmSignOut';

const SIGNED_IN_SPEECH_MAX_MS = 4000;

export default function SignInScreen() {
  const { account, expiredAccount, createAccount, continueAsGuest, signOut } = useSession();
  const narrator = useNarrator();
  const [mode, setMode] = useState<Mode>(() => (account && !expiredAccount ? 'account' : 'choices'));
  const [handle, setHandle] = useState(expiredAccount?.handle ?? '');
  const [notice, setNotice] = useState(expiredAccount ? authMessages.expired : '');
  const [createStatus, setCreateStatus] = useState({ message: authMessages.createAccount, error: false, busy: false });
  const [signingOut, setSigningOut] = useState(false);
  const [returns, setReturns] = useState(0);
  const shown = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (shown.current) setReturns((count) => count + 1);
      shown.current = true;
    }, []),
  );

  const finish = useCallback(
    async (_account: SocialAccount, message: string) => {
      haptic('next');
      narrator.speak(message);
      await afterSpeech(narrator, SIGNED_IN_SPEECH_MAX_MS);
      returnToFeed();
    },
    [narrator],
  );

  const message =
    mode === 'choices'
      ? `${notice} ${authMessages.choices}`.trim()
      : mode === 'create'
        ? createStatus.message
        : mode === 'account' && account
          ? authMessages.signedIn(account)
          : mode === 'confirmSignOut'
            ? authMessages.confirmSignOut
            : '';
  const statusRef = useStatus(message, { key: `${mode}:${returns}` });

  if (mode === 'handle') {
    return (
      <HandleSignIn
        initialHandle={handle}
        onSignedIn={finish}
        onAppPassword={(entered) => {
          setHandle(entered);
          setMode('appPassword');
        }}
        onBack={() => setMode('choices')}
      />
    );
  }

  if (mode === 'appPassword') return <AppPasswordSignIn initialHandle={handle} onSignedIn={finish} onBack={() => setMode('handle')} />;

  const openSignUp = async () => {
    setCreateStatus((current) => ({ ...current, busy: true }));
    const result: SignInResult = await createAccount();
    if (result.status === 'success') return finish(result.account, authMessages.signedIn(result.account));
    haptic('edge');
    setCreateStatus({
      busy: false,
      error: result.status === 'failed',
      message:
        result.status === 'cancelled'
          ? authMessages.createCancelled
          : result.reason === 'network'
            ? authMessages.createNetworkFailure
            : authMessages.createServerFailure,
    });
  };

  if (mode === 'create') {
    return (
      <AuthScreen onEscape={() => setMode('choices')}>
        <Heading>Create an account</Heading>
        <Status message={createStatus.message} error={createStatus.error} statusRef={statusRef} />
        <AuthButton
          label={createStatus.busy ? 'Opening Bluesky' : 'Open Bluesky sign-up'}
          hint="Opens Bluesky's own sign-up page in a secure sheet. You come back here signed in."
          onPress={openSignUp}
          busy={createStatus.busy}
          primary
        />
        <AuthButton label="Back" hint="Returns to the first screen." onPress={() => setMode('choices')} />
      </AuthScreen>
    );
  }

  if (mode === 'account' && account) {
    return (
      <AuthScreen onEscape={returnToFeed}>
        <Heading>Account</Heading>
        <Status message={message} statusRef={statusRef} />
        <AuthButton label="Back to the feed" hint="Returns to your timeline." onPress={returnToFeed} primary />
        <AuthButton label="Sign out" hint="Asks before signing you out of Bluesky on this device." onPress={() => setMode('confirmSignOut')} />
        <PracticeButton />
      </AuthScreen>
    );
  }

  if (mode === 'confirmSignOut') {
    return (
      <AuthScreen onEscape={() => setMode('account')}>
        <Heading>Sign out?</Heading>
        <Status message={message} statusRef={statusRef} />
        <AuthButton
          label={signingOut ? 'Signing out' : 'Sign out'}
          hint="Removes your Bluesky sign-in and its keys from this device."
          onPress={async () => {
            setSigningOut(true);
            await signOut();
            setSigningOut(false);
            haptic('next');
            setNotice(authMessages.signedOut);
            setMode('choices');
          }}
          busy={signingOut}
          primary
        />
        <AuthButton label="Cancel" hint="Keeps you signed in." onPress={() => setMode('account')} busy={signingOut} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Heading>{`Welcome to ${APP_NAME}`}</Heading>
      <Status message={message} statusRef={statusRef} />
      <AuthButton
        label="Sign in"
        hint={`Sign in with your Bluesky handle. You enter your password on Bluesky's own page, never in ${APP_NAME}.`}
        onPress={() => setMode('handle')}
        primary
      />
      <AuthButton label="Create an account" hint="Explains what Bluesky's sign-up asks for, then opens it." onPress={() => setMode('create')} />
      <AuthButton
        label="Listen without signing in"
        hint="Plays a public feed. You can sign in later from the agent screen."
        onPress={async () => {
          haptic('next');
          await continueAsGuest();
          returnToFeed();
        }}
      />
      <PracticeButton />
    </AuthScreen>
  );
}

function PracticeButton() {
  return (
    <AuthButton
      label="Practice the gestures"
      hint="Opens gesture practice, where you try each gesture with spoken feedback. You come back here when you finish."
      onPress={() => router.push('/practice')}
    />
  );
}
