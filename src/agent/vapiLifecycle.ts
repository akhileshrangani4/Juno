// Vapi's React Native SDK leaves a call running when stop() comes before start() has made its Daily call object:
// stop() finds nothing to clean up, and start() goes on to create the call object and join. Daily allows one call
// object per app, so on build 721d9ab every wake after an early exit failed with "Duplicate DailyIframe instances
// are not allowed" until Vapi's server ended the orphan 80 seconds later. Here every stop tears the call down
// whatever stage start() is in, a wake first waits (bounded) for the last teardown, and a duplicate left over
// anyway is destroyed and the start tried once more.

import type { CallListener, VapiMessage, VoiceCall } from './voiceCall';

// How long a stop lets a start in flight reach its call object before destroying whatever exists.
export const START_SETTLE_MS = 4000;
// How long a wake waits for the previous call's teardown before connecting anyway.
export const TEARDOWN_WAIT_MS = 5000;

export type CallObject = { destroy(): Promise<void>; isDestroyed(): boolean };

export type SdkEvents = {
  message(message: VapiMessage): void;
  end(): void;
  error(error: unknown): void;
  joined(): void;
};

// One Vapi client, used for one attempt to start a call.
export type VapiSdk = {
  // Resolves with the call once it has joined, or null when it failed (the SDK reports why as an error event).
  start(assistant: object): Promise<unknown>;
  stop(): void;
  say(text: string, interrupt?: boolean): void;
  send(message: object): void;
  // The Daily call object this client made, if any.
  callObject(): CallObject | null;
};

export type CallDeps = {
  newSdk(publicKey: string, events: SdkEvents): VapiSdk;
  // The app's one Daily call object, whoever made it.
  existingCallObject(): CallObject | null;
  wait(ms: number): Promise<void>;
};

type Attempt = 'joined' | 'duplicate' | 'failed' | 'stopped';

const isDuplicate = (error: unknown) => /duplicate dailyiframe/i.test(error instanceof Error ? error.message : String(error));

async function destroy(object: CallObject | null) {
  if (object && !object.isDestroyed()) await object.destroy().catch(() => undefined);
}

export function voiceCalls(deps: CallDeps): (publicKey: string) => VoiceCall {
  let teardown: Promise<void> = Promise.resolve();

  return (publicKey) => {
    let sdk: VapiSdk | null = null;
    let starting: Promise<unknown> | null = null;
    let listener: CallListener | null = null;
    let settleAttempt: ((attempt: Attempt) => void) | null = null;
    let stopped = false;

    const attempt = (assistant: object) =>
      new Promise<Attempt>((resolve) => {
        let duplicate = false;
        settleAttempt = resolve;
        const current = deps.newSdk(publicKey, {
          message: (message) => sdk === current && listener?.onMessage(message),
          end: () => sdk === current && listener?.onEnd(),
          error: (error) => {
            if (isDuplicate(error)) duplicate = true;
            if (sdk === current) listener?.onError(error);
          },
          joined: () => resolve('joined'),
        });
        sdk = current;
        starting = current.start(assistant).then(
          (call) => {
            if (!call) resolve(duplicate ? 'duplicate' : 'failed');
          },
          (error: unknown) => resolve(duplicate || isDuplicate(error) ? 'duplicate' : 'failed'),
        );
      });

    // The SDK's own stop() destroys a call object that exists by then; one that start() makes afterwards is
    // destroyed here, once start() gets that far or the wait runs out, and again if a slow join makes it later.
    const tearDown = async (current: VapiSdk, inFlight: Promise<unknown> | null) => {
      const cleaning = current.callObject();
      current.stop();
      const destroyLate = () => {
        const late = current.callObject();
        return late === cleaning ? undefined : destroy(late);
      };
      if (inFlight) await Promise.race([inFlight, deps.wait(START_SETTLE_MS)]);
      await destroyLate();
      void inFlight?.then(destroyLate);
    };

    return {
      async start(assistant, next) {
        listener = next;
        await Promise.race([teardown, deps.wait(TEARDOWN_WAIT_MS)]);
        for (const retry of [false, true]) {
          if (retry) await destroy(deps.existingCallObject());
          if (stopped) return;
          const outcome = await attempt(assistant);
          if (outcome === 'joined' || outcome === 'stopped') return;
          if (outcome === 'failed' || retry) throw new Error(outcome === 'duplicate' ? 'A previous call is still open' : 'Vapi did not start the call');
        }
      },
      stop() {
        if (stopped) return;
        stopped = true;
        listener = null;
        settleAttempt?.('stopped');
        const current = sdk;
        if (!current) return;
        const inFlight = starting;
        teardown = teardown.then(() => tearDown(current, inFlight));
      },
      say: (text, interrupt) => sdk?.say(text, interrupt),
      addMessage: (content, triggerResponse) => sdk?.send({ type: 'add-message', message: { role: 'system', content }, triggerResponseEnabled: triggerResponse }),
    };
  };
}
