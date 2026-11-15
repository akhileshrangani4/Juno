import type { VoiceCall } from './voiceCall';

export function createVoiceCall(_publicKey: string): VoiceCall {
  return {
    start: async () => {
      throw new Error('The voice agent needs the iOS or Android app.');
    },
    stop: () => undefined,
    say: () => undefined,
    addMessage: () => undefined,
    setMuted: () => undefined,
    muteAssistant: () => undefined,
  };
}
