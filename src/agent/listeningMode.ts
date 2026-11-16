import { secureStore, type KeyValueStore } from '@/storage/keyValueStore';

import type { CallListener, VoiceCall } from './voiceCall';

// How the agent hears the user. Hands-free (the default) keeps the microphone open for the whole call. In push to
// talk the microphone is muted from the moment the call is live, except while one finger is held on the screen.
export type ListeningMode = 'handsFree' | 'pushToTalk';

const STORAGE_KEY = 'agent.listeningMode';

export class ListeningModeStore {
  private value: ListeningMode = 'handsFree';
  private changed = false;
  private readonly listeners = new Set<(mode: ListeningMode) => void>();

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<ListeningMode> {
    return this.store
      .get(STORAGE_KEY)
      .then((saved) => {
        if (!this.changed && saved === 'pushToTalk') this.notify('pushToTalk');
        return this.value;
      })
      .catch(() => this.value);
  }

  get = (): ListeningMode => this.value;

  set(mode: ListeningMode): void {
    this.changed = true;
    this.store.set(STORAGE_KEY, mode).catch(() => undefined);
    this.notify(mode);
  }

  subscribe = (listener: (mode: ListeningMode) => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private notify(mode: ListeningMode) {
    if (mode === this.value) return;
    this.value = mode;
    this.listeners.forEach((listener) => listener(mode));
  }
}

export const listeningMode = new ListeningModeStore(secureStore);
void listeningMode.load();

export type TalkHold = { start(): void; end(cancelled: boolean): void };
type Mode = { get(): ListeningMode; subscribe(listener: (mode: ListeningMode) => void): () => void };
type Cues = { pressed(): void; released(): void };

// Wraps the call for push to talk without changing how it starts or stops. In hands-free every call passes straight
// through and nothing is muted. In push to talk the microphone is muted once the call is live; talk() gives the hold
// that unmutes it while a finger is down, and silences the agent if it was speaking when the finger went down.
export function withPushToTalk(call: VoiceCall, mode: Mode, cues: Cues): { call: VoiceCall; talk(): TalkHold | undefined; dispose(): void } {
  let live = false;
  let ended = false;
  let held = false;
  let assistantSpeaking = false;
  let assistantMuted = false;
  const pushToTalk = () => mode.get() === 'pushToTalk';
  const restoreAssistant = () => {
    if (!assistantMuted) return;
    assistantMuted = false;
    call.muteAssistant?.(false);
  };
  const unsubscribe = mode.subscribe((next) => {
    if (live) call.setMuted?.(next === 'pushToTalk' && !held);
  });

  const wrapped: VoiceCall = {
    ...call,
    start: (assistant: object, listener: CallListener) =>
      call
        .start(assistant, {
          ...listener,
          onMessage: (message) => {
            if (message.type === 'speech-update' && message.role === 'assistant') assistantSpeaking = message.status === 'started';
            if (message.type === 'transcript' && message.role === 'user') restoreAssistant();
            listener.onMessage(message);
          },
        })
        .then(() => {
          if (ended) return;
          live = true;
          if (pushToTalk()) call.setMuted?.(true);
        }),
    stop: () => {
      live = false;
      ended = true;
      call.stop();
    },
  };

  return {
    call: wrapped,
    talk: () =>
      live && pushToTalk()
        ? {
            start: () => {
              held = true;
              call.setMuted?.(false);
              if (assistantSpeaking) {
                assistantMuted = true;
                call.muteAssistant?.(true);
              }
              cues.pressed();
            },
            end: () => {
              held = false;
              if (live && pushToTalk()) call.setMuted?.(true);
              restoreAssistant();
              cues.released();
            },
          }
        : undefined,
    dispose: unsubscribe,
  };
}
