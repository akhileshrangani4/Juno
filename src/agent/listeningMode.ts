import { secureStore, type KeyValueStore } from '@/storage/keyValueStore';

import type { CallListener, VoiceCall } from './voiceCall';

// How the agent hears the user. Push to talk (the default) keeps the agent from hearing anything except while one
// finger is held on the screen, and during the five seconds before a send, so "undo" needs no hold. Hands-free
// listens for the whole call; once chosen it is remembered.
export type ListeningMode = 'handsFree' | 'pushToTalk';

const STORAGE_KEY = 'agent.listeningMode';

export class ListeningModeStore {
  private value: ListeningMode = 'pushToTalk';
  private changed = false;
  private readonly listeners = new Set<(mode: ListeningMode) => void>();

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<ListeningMode> {
    return this.store
      .get(STORAGE_KEY)
      .then((saved) => {
        if (!this.changed && (saved === 'pushToTalk' || saved === 'handsFree')) this.notify(saved);
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

// How often the open-microphone window (a send counting down) is checked.
export const OPEN_POLL_MS = 200;
// After the finger lifts the agent keeps listening this long, so the last word isn't cut off.
export const RELEASE_TAIL_MS = 400;

export type PushToTalkDeps = {
  // The hold started (true) or ended (false): the haptic, the tone and the on-screen state.
  cue(talking: boolean): void;
  // While true the agent hears the user without a hold: a confirmed send is counting down or going out.
  openWhile(): boolean;
  schedule(run: () => void, ms: number): () => void;
  now(): number;
  log(event: string, detail?: Record<string, unknown>): void;
};

// Wraps the call for push to talk without changing how it starts or stops. Hands-free passes everything straight
// through. In push to talk the agent stops hearing the user once the call is live (Vapi's mute-customer control:
// the phone's microphone stays on, so nothing has to start up again when the user holds); a hold, and a send
// counting down, let it hear them again. A hold while the agent speaks silences it until the user is heard.
export function withPushToTalk(call: VoiceCall, mode: Mode, deps: PushToTalkDeps): { call: VoiceCall; talk(): TalkHold | undefined; dispose(): void } {
  let live = false;
  let ended = false;
  let held = false;
  let heldAt = 0;
  let openedAt = 0;
  let tail: (() => void) | null = null;
  let muted: boolean | null = null;
  let assistantSpeaking = false;
  let assistantMuted = false;
  let poll: (() => void) | null = null;
  const pushToTalk = () => mode.get() === 'pushToTalk';

  const update = (reason: string) => {
    if (!live) return;
    const next = pushToTalk() && !held && !tail && !deps.openWhile();
    if (next === muted) return;
    if (muted === null && !next) {
      muted = false;
      return;
    }
    muted = next;
    if (!next) openedAt = deps.now();
    call.muteCustomer?.(next);
    deps.log('mic', { muted: next, reason });
  };
  const watch = () => {
    poll = deps.schedule(() => {
      update('countdown');
      if (live) watch();
    }, OPEN_POLL_MS);
  };
  const restoreAssistant = () => {
    if (!assistantMuted) return;
    assistantMuted = false;
    call.muteAssistant?.(false);
  };
  const unsubscribe = mode.subscribe(() => update('mode'));

  const wrapped: VoiceCall = {
    ...call,
    start: (assistant: object, listener: CallListener) =>
      call
        .start(assistant, {
          ...listener,
          onMessage: (message) => {
            if (message.type === 'speech-update' && message.role === 'assistant') assistantSpeaking = message.status === 'started';
            if (message.type === 'transcript' && message.role === 'user') {
              restoreAssistant();
              if (message.transcriptType === 'final' && pushToTalk()) {
                deps.log('heard', { chars: String(message.transcript ?? '').length, held, sinceOpenMs: muted === false ? deps.now() - openedAt : null });
              }
            }
            listener.onMessage(message);
          },
        })
        .then(() => {
          if (ended) return;
          live = true;
          update('call live');
          watch();
        }),
    stop: () => {
      live = false;
      ended = true;
      poll?.();
      tail?.();
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
              heldAt = deps.now();
              tail?.();
              tail = null;
              update('hold');
              if (assistantSpeaking) {
                assistantMuted = true;
                call.muteAssistant?.(true);
              }
              deps.cue(true);
              deps.log('talk start', { agentSpeaking: assistantSpeaking });
            },
            end: (cancelled) => {
              held = false;
              deps.cue(false);
              deps.log('talk end', { heldMs: deps.now() - heldAt, cancelled });
              tail = deps.schedule(() => {
                tail = null;
                update('release');
              }, RELEASE_TAIL_MS);
              restoreAssistant();
            },
          }
        : undefined,
    dispose: () => {
      unsubscribe();
      poll?.();
      tail?.();
    },
  };
}
