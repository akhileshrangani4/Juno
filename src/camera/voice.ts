import type { Narrator } from '@/narration/Narrator';

// One voice. While a voice call is live it owns the audio, so everything the camera says goes through the
// agent's voice (say() speaks the app's exact words) and on-device speech is never used. That path is slower, so
// during a call fine cues ("move left", "hold steady") are not spoken at all: the haptic ticks carry them, and only
// key cues, descriptions and status lines are. With no call, the on-device narrator speaks (VoiceOver's
// announcements when VoiceOver is on).

export type SpeechKind = 'cue' | 'keyCue' | 'description' | 'status';

export type AgentVoiceLink = { live(): boolean; say(text: string): boolean };

// How long the agent takes to say something, since the app doesn't hear when it finishes.
export const agentSpeechMs = (text: string) => 900 + text.length * 70;

export class CameraVoice {
  private agentBusyUntil = 0;

  constructor(
    private readonly deps: { narrator: Narrator; agent: AgentVoiceLink; now(): number; schedule(run: () => void, ms: number): () => void },
  ) {}

  inCall(): boolean {
    return this.deps.agent.live();
  }

  busy(): boolean {
    return this.inCall() ? this.deps.now() < this.agentBusyUntil : this.deps.narrator.speaking();
  }

  // Resolves when the words have been spoken (or would have been). Returns false at once for words dropped
  // because a call is live and they are only a fine cue.
  speak(text: string, kind: SpeechKind): Promise<boolean> {
    if (this.inCall()) {
      if (kind === 'cue' || !this.deps.agent.say(text)) return Promise.resolve(false);
      const ms = agentSpeechMs(text);
      this.agentBusyUntil = Math.max(this.agentBusyUntil, this.deps.now()) + ms;
      return new Promise((resolve) => this.deps.schedule(() => resolve(true), ms));
    }
    const { narrator } = this.deps;
    return new Promise((resolve) => {
      let cancel = () => undefined as void;
      const done = () => {
        off();
        cancel();
        resolve(true);
      };
      const off = narrator.onDone(done);
      cancel = this.deps.schedule(done, 4000 + text.length * 80);
      narrator.speak(text);
    });
  }

  stop(): void {
    if (!this.inCall()) this.deps.narrator.stop();
  }
}
