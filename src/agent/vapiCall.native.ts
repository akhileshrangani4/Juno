import 'react-native-get-random-values';

import Vapi from '@vapi-ai/react-native';

import type { CallListener, VoiceCall } from './voiceCall';

export function createVoiceCall(publicKey: string): VoiceCall {
  const vapi = new Vapi(publicKey);
  let listener: CallListener | null = null;
  vapi.on('message', (message) => listener?.onMessage(message));
  vapi.on('call-end', () => listener?.onEnd());
  vapi.on('error', (error) => listener?.onError(error));

  return {
    start: (assistant, next) =>
      new Promise<void>((resolve, reject) => {
        listener = next;
        const joined = () => {
          vapi.removeListener('call-start', joined);
          resolve();
        };
        vapi.on('call-start', joined);
        vapi.start(assistant as Parameters<Vapi['start']>[0]).then(
          (call) => {
            if (call) return;
            vapi.removeListener('call-start', joined);
            reject(new Error('Vapi did not start the call'));
          },
          (error: unknown) => {
            vapi.removeListener('call-start', joined);
            reject(error);
          },
        );
      }),
    stop: () => vapi.stop(),
    say: (text, interrupt) => vapi.say(text, false, true, interrupt),
    setMuted: (muted) => {
      try {
        vapi.setMuted(muted);
      } catch (error) {
        listener?.onError(error);
      }
    },
    muteAssistant: (muted) => vapi.send({ type: 'control', control: muted ? 'mute-assistant' : 'unmute-assistant' }),
    addMessage: (content, triggerResponse) =>
      vapi.send({ type: 'add-message', message: { role: 'system', content }, triggerResponseEnabled: triggerResponse } as Parameters<Vapi['send']>[0]),
  };
}
