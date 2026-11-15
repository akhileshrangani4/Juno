import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import { agentMessages } from './agentMessages';

// Explains the microphone by voice before iOS shows its permission prompt, the first time only.
export async function ensureMicrophone(speakAndWait: (text: string) => Promise<void>): Promise<'granted' | 'denied'> {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'denied';
  await speakAndWait(agentMessages.micExplain);
  const answer = await requestRecordingPermissionsAsync();
  return answer.granted ? 'granted' : 'denied';
}
