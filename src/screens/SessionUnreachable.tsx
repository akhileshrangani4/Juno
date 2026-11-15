import { APP_NAME } from '@/appName';
import { authMessages } from '@/auth/messages';
import { AuthButton, AuthScreen, Heading, Status, useStatus } from '@/screens/auth/AuthControls';
import { useSession } from '@/session/SessionContext';

export function SessionUnreachable() {
  const { retrying, restoreAttempt, retryRestore, listenForNow } = useSession();
  const message = retrying ? authMessages.retrying : authMessages.unreachable;
  const statusRef = useStatus(message, { key: `${restoreAttempt}-${retrying}` });

  return (
    <AuthScreen>
      <Heading>{"Can't reach Bluesky"}</Heading>
      <Status message={message} statusRef={statusRef} />
      <AuthButton
        label={retrying ? 'Retrying' : 'Retry'}
        hint="Tries to reach Bluesky again. You stay signed in."
        onPress={() => void retryRestore()}
        busy={retrying}
        primary
      />
      <AuthButton
        label="Listen without signing in"
        hint={`Plays a public feed for now. You stay signed in, and ${APP_NAME} tries your timeline again the next time it opens.`}
        onPress={listenForNow}
        busy={retrying}
      />
    </AuthScreen>
  );
}
