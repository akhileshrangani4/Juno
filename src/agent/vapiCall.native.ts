import 'react-native-get-random-values';

import Daily from '@daily-co/react-native-daily-js';
import Vapi from '@vapi-ai/react-native';

import { voiceCalls, type CallObject } from './vapiLifecycle';

export const createVoiceCall = voiceCalls({
  newSdk: (publicKey, events) => {
    const vapi = new Vapi(publicKey);
    vapi.on('message', events.message);
    vapi.on('call-end', events.end);
    vapi.on('error', events.error);
    vapi.on('call-start', events.joined);
    return {
      start: (assistant) => vapi.start(assistant as Parameters<Vapi['start']>[0]),
      stop: () => vapi.stop(),
      say: (text, interrupt) => vapi.say(text, false, true, interrupt),
      setMuted: (muted) => {
        try {
          vapi.setMuted(muted);
        } catch {
          // No call object yet or any more: nothing to mute.
        }
      },
      send: (message) => vapi.send(message as Parameters<Vapi['send']>[0]),
      callObject: () => (vapi as unknown as { call: CallObject | null }).call,
    };
  },
  existingCallObject: () => Daily.getCallInstance() ?? null,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
