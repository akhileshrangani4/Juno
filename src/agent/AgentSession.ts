import type { Post } from '@/social/types';

import { agentMessages } from './agentMessages';
import { AgentVoice } from './agentVoice';
import type { ListeningMode } from './listeningMode';
import { describeFocus } from './postContext';
import type { Conversation, Heard, ToolHandlers, ToolOutcome } from './toolHandlers';
import type { VapiMessage, VoiceCall } from './voiceCall';

export type EndReason = 'user' | 'agent' | 'silence' | 'maxDuration' | 'dropped' | 'failed' | 'micDenied' | 'notConfigured' | 'signIn';

export type AgentStatus = 'starting' | 'connecting' | 'listening' | 'ended';

export const CONNECT_TIMEOUT_MS = 20_000;
export const COUNTDOWN_FALLBACK_MS = 6_000;

// The app, not Vapi, decides when a quiet call goes to sleep, since in push to talk Vapi hears silence whenever no
// finger is down. Quiet is counted from the last thing anyone said, or the last release, and stands still while
// the agent speaks or a finger is held. Push to talk waits longer: the user has to find the screen and hold it
// before they can say anything. The "are you still there" warning comes STILL_THERE_BEFORE_MS before sleep.
export const QUIET_LIMIT_MS: Record<ListeningMode, number> = { handsFree: 30_000, pushToTalk: 60_000 };
export const STILL_THERE_BEFORE_MS = 13_000;
// After a release in which the user was heard speaking during a paused countdown, how long the app waits for
// their words before treating them as unclear, which holds the send (anything but a yes or an acknowledgement).
export const WORDS_AFTER_RELEASE_MS = 3000;
// A press silences the agent's voice; it comes back when that speech has stopped, or after this long at most.
export const VOICE_BACK_AFTER_MS = 15_000;

export type TalkCue = 'talkStart' | 'talkEnd' | 'interrupt';


export type SessionDeps = {
  call: VoiceCall | null;
  handlers: ToolHandlers;
  conversation: ConversationLog;
  microphone(): Promise<'granted' | 'denied'>;
  assistant(): Promise<object>;
  status(status: AgentStatus): void;
  // Haptic plus the app's own spoken cue; the agent's first message is the spoken "listening" cue.
  connecting(): void;
  listening(): void;
  exit(reason: EndReason, message: string): void;
  listening: { get(): ListeningMode; subscribe(listener: (mode: ListeningMode) => void): () => void };
  // Haptic, and in push to talk a tone; returns how long the tone plays, so the microphone opens after it.
  cue(cue: TalkCue): number;
  schedule(run: () => void, ms: number): () => void;
  now(): number;
  log(event: string, detail?: Record<string, unknown>): void;
};

export class ConversationLog implements Conversation {
  private readonly utterances: string[] = [];

  add(utterance: string) {
    this.utterances.push(utterance.trim());
  }

  turn() {
    return this.utterances.length;
  }

  lastUtterance() {
    return this.utterances[this.utterances.length - 1] ?? '';
  }

  recentUtterances() {
    return this.utterances.slice(-4);
  }
}

const END_REASONS: Record<string, EndReason> = {
  'silence-timed-out': 'silence',
  'exceeded-max-duration': 'maxDuration',
  'customer-ended-call': 'user',
  'assistant-ended-call': 'agent',
};

const EXIT_MESSAGES: Record<EndReason, string> = {
  user: agentMessages.asleep,
  agent: agentMessages.asleep,
  silence: agentMessages.silence,
  maxDuration: agentMessages.maxDuration,
  dropped: agentMessages.dropped,
  failed: agentMessages.couldNotConnect,
  micDenied: agentMessages.micDenied,
  notConfigured: agentMessages.notConfigured,
  signIn: agentMessages.signIn,
};

export class AgentSession {
  private live = false;
  private finished = false;
  private countdownArmed: (() => void) | null = null;
  private announcementStarted = false;
  private focusUri: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly voice: AgentVoice;
  private mode: ListeningMode;
  private offMode: (() => void) | null = null;
  private holding = false;
  private spokeWhileHolding = false;
  private answeredWhilePaused = false;
  private openMicrophone: (() => void) | null = null;
  private waitForWords: (() => void) | null = null;
  private assistantSpeaking = false;
  private userSpeaking = false;
  private voiceSilenced: (() => void) | null = null;
  private quiet: (() => void)[] = [];
  private warned = false;

  constructor(private readonly deps: SessionDeps) {
    this.voice = new AgentVoice(deps.now);
    this.mode = deps.listening.get();
  }

  async start(): Promise<void> {
    const { deps } = this;
    deps.status('starting');
    if (!deps.call) return this.finish('notConfigured');
    if ((await deps.microphone()) !== 'granted') return this.finish('micDenied');
    if (this.finished) return;
    deps.status('connecting');
    deps.connecting();
    deps.log('connecting');
    try {
      const assistant = await deps.assistant();
      if (this.finished) return;
      await new Promise<void>((resolve, reject) => {
        const cancel = deps.schedule(() => reject(new Error('Timed out connecting')), CONNECT_TIMEOUT_MS);
        deps.call!.start(assistant, { onMessage: (message) => this.onMessage(message), onEnd: () => this.finish('dropped'), onError: (error) => this.onError(error) }).then(
          () => {
            cancel();
            resolve();
          },
          (error: unknown) => {
            cancel();
            reject(error);
          },
        );
      });
    } catch (error) {
      deps.log('connect failed', { error: error instanceof Error ? error.message : String(error) });
      deps.call.stop();
      return this.finish('failed');
    }
    if (this.finished) return deps.call.stop();
    this.live = true;
    this.mode = deps.listening.get();
    this.muteForMode();
    this.offMode = deps.listening.subscribe((mode) => this.modeChanged(mode));
    deps.log('connected', { mode: this.mode });
    deps.status('listening');
    deps.listening();
    this.restartQuiet();
  }

  // A finger came down and stayed (the talk hold). In push to talk the microphone opens once the rising tone has
  // played, so the tone is never heard as the user's speech. In either mode a press silences the agent at once.
  holdStart(): void {
    if (!this.live || this.holding) return;
    if (this.assistantSpeaking) this.silenceVoice();
    if (this.mode !== 'pushToTalk') {
      if (this.voiceSilenced) this.deps.cue('interrupt');
      return;
    }
    this.holding = true;
    this.spokeWhileHolding = false;
    this.warned = false;
    this.stopQuiet();
    this.cancelWaitForWords();
    if (this.deps.handlers.publisher.pauseCountdown()) {
      this.answeredWhilePaused = false;
      this.deps.log('countdown paused');
    }
    this.openMicrophone = this.deps.schedule(() => {
      this.openMicrophone = null;
      this.deps.call?.setMuted(false);
      this.deps.log('hold unmuted');
    }, this.deps.cue('talkStart'));
  }

  // The finger lifted, or the system took the touch (cancelled). The microphone closes before the falling tone.
  holdEnd(cancelled = false): void {
    if (!this.holding) return;
    this.holding = false;
    this.openMicrophone?.();
    this.openMicrophone = null;
    this.deps.call?.setMuted(true);
    this.deps.log('hold muted', cancelled ? { cancelled } : undefined);
    this.deps.cue('talkEnd');
    if (this.voiceSilenced && !this.assistantSpeaking) this.restoreVoice();
    this.restartQuiet();
    if (!this.deps.handlers.publisher.countdownPaused) return;
    if (!this.spokeWhileHolding || this.answeredWhilePaused) return this.resumeCountdown();
    this.waitForWords = this.deps.schedule(() => this.wordsNeverCame(), WORDS_AFTER_RELEASE_MS);
  }

  get listeningMode(): ListeningMode {
    return this.mode;
  }

  stop(reason: EndReason = 'user'): void {
    if (this.finished) return;
    this.deps.call?.stop();
    this.finish(reason);
  }

  // Something finished outside a tool call (a post was sent). With speak, the app says it word for word and the
  // model only hears about it; otherwise the model is asked to tell the user.
  notify(text: string, speak?: string): void {
    if (!this.live) return;
    if (speak) this.speak(speak);
    this.deps.call?.addMessage(text, !speak);
  }

  // While the call is live it owns the audio, so the app's own messages (gesture help) are spoken by the agent.
  say(text: string): boolean {
    if (!this.live) return false;
    this.speak(text);
    this.deps.call?.addMessage(`The app just said this to the user: "${text}". Don't repeat it.`, false);
    return true;
  }

  focusChanged(post: Post | null): void {
    const uri = post?.uri ?? null;
    if (uri === this.focusUri) return;
    this.focusUri = uri;
    if (this.live) this.deps.call?.addMessage(`Focus changed. The post in focus is now: ${describeFocus(post)}`, false);
  }

  private onError(error: unknown) {
    this.deps.log('call error', { error: error instanceof Error ? error.message : typeof error === 'object' ? JSON.stringify(error).slice(0, 200) : String(error) });
    if (this.live) this.finish('dropped');
  }

  private onMessage(message: VapiMessage) {
    switch (message.type) {
      case 'transcript':
        if (message.role === 'user' && this.holding) this.spokeWhileHolding = true;
        if (message.transcriptType !== 'final' || typeof message.transcript !== 'string') return;
        if (message.role === 'user') this.onUserSaid(message.transcript);
        if (message.role === 'assistant') this.onAssistantSaid(message.transcript);
        return;
      case 'tool-calls':
        for (const call of (message.toolCallList as ToolCall[] | undefined) ?? []) this.queue = this.queue.then(() => this.runTool(call));
        return;
      case 'assistant.speechStarted':
        this.voice.sourceReported(message.source, message.turn);
        return;
      case 'speech-update':
        if (message.role === 'user') return this.userSpeech(message.status === 'started');
        if (message.role === 'assistant') this.assistantSpeech(message.status === 'started');
        if (message.role === 'assistant' && message.status === 'started') this.voice.speechStarted(message.turn);
        if (message.role !== 'assistant' || !this.countdownArmed) return;
        if (message.status === 'started') this.announcementStarted = true;
        if (message.status === 'stopped' && this.announcementStarted) this.startCountdown();
        return;
      case 'status-update':
        if (message.status === 'ended') {
          this.deps.log('ended', { reason: message.endedReason });
          this.finish(END_REASONS[String(message.endedReason)] ?? 'dropped');
        }
        return;
    }
  }

  private onUserSaid(transcript: string) {
    this.deps.conversation.add(transcript);
    this.warned = false;
    this.restartQuiet();
    if (this.voiceSilenced) this.restoreVoice();
    const heard = this.deps.handlers.heard(transcript);
    if (heard) return this.answerDuringCountdown(heard);
    if (!this.deps.handlers.publisher.countdownPaused) return;
    this.answeredWhilePaused = true;
    if (!this.holding) this.resumeCountdown();
  }

  private answerDuringCountdown(heard: Heard) {
    this.cancelWaitForWords();
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.deps.log(heard.kind === 'held' ? 'held from transcript' : 'undone from transcript');
    this.speak(heard.speak);
    this.deps.call?.addMessage(heard.message, false);
  }

  // The user was heard speaking during a hold that paused the countdown, and no words arrived: not a yes, so held.
  private wordsNeverCame() {
    this.waitForWords = null;
    const held = this.deps.handlers.heardUnclear();
    if (held) this.answerDuringCountdown(held);
    else this.resumeCountdown();
  }

  private resumeCountdown() {
    this.cancelWaitForWords();
    if (!this.deps.handlers.publisher.countdownPaused) return;
    this.deps.handlers.publisher.resumeCountdown();
    this.deps.log('countdown resumed');
  }

  private cancelWaitForWords() {
    this.waitForWords?.();
    this.waitForWords = null;
  }

  private modeChanged(mode: ListeningMode) {
    if (mode === this.mode) return;
    if (this.holding) this.holdEnd();
    this.mode = mode;
    this.deps.log('listening mode', { mode });
    this.muteForMode();
    this.restartQuiet();
  }

  private muteForMode() {
    const muted = this.mode === 'pushToTalk';
    this.deps.call?.setMuted(muted);
    this.deps.log(muted ? 'mic muted' : 'mic unmuted');
  }

  // Vapi's own barge-in needs the user's voice; a press stops the agent before they have said anything.
  private silenceVoice() {
    if (this.voiceSilenced) return;
    this.deps.call?.muteAssistant(true);
    this.voiceSilenced = this.deps.schedule(() => this.restoreVoice(), VOICE_BACK_AFTER_MS);
    this.deps.log('agent interrupted');
  }

  private restoreVoice() {
    if (!this.voiceSilenced) return;
    this.voiceSilenced();
    this.voiceSilenced = null;
    this.deps.call?.muteAssistant(false);
    this.deps.log('agent voice back');
  }

  private userSpeech(started: boolean) {
    this.userSpeaking = started;
    if (!started) return this.restartQuiet();
    if (this.holding) this.spokeWhileHolding = true;
    this.warned = false;
    this.stopQuiet();
  }

  private assistantSpeech(started: boolean) {
    this.assistantSpeaking = started;
    if (started) {
      if (!this.warned) this.stopQuiet();
      return;
    }
    if (this.voiceSilenced && !this.holding) this.restoreVoice();
    if (!this.warned || !this.quiet.length) this.restartQuiet();
  }

  // Quiet starts now: a warning, then sleep. After the warning, only the user (speaking or holding) starts it over.
  private restartQuiet() {
    this.stopQuiet();
    if (!this.live || this.holding || this.userSpeaking || this.assistantSpeaking) return;
    const limit = QUIET_LIMIT_MS[this.mode];
    if (this.warned) {
      this.quiet = [this.deps.schedule(() => this.stop('silence'), STILL_THERE_BEFORE_MS)];
      return;
    }
    this.quiet = [
      this.deps.schedule(() => {
        this.warned = true;
        this.speak(agentMessages.stillThere);
      }, limit - STILL_THERE_BEFORE_MS),
      this.deps.schedule(() => this.stop('silence'), limit),
    ];
  }

  private stopQuiet() {
    this.quiet.forEach((cancel) => cancel());
    this.quiet = [];
  }

  // The model's own words (not the app's, which go through speak) void a read-back the user hasn't answered. While
  // one is waiting for an answer, every assistant transcript is logged with who it was put down to, never its words.
  private onAssistantSaid(transcript: string) {
    const awaiting = this.deps.handlers.publisher.awaitingAnswer;
    const { speaker, by, source, turn } = this.voice.attribute(transcript);
    if (awaiting) this.deps.log('assistant speech during read-back', { speaker, by, source, turn });
    if (speaker === 'model' && this.deps.handlers.assistantSaid()) this.deps.log('yes voided by assistant speech', { by, source, turn });
  }

  // Everything the app says in the agent's voice goes through here, so its transcript is known to be the app's.
  private speak(text: string) {
    this.voice.appSays(text);
    const silenced = this.voiceSilenced !== null;
    if (silenced) this.restoreVoice();
    this.deps.call?.say(text, silenced);
  }

  private async runTool(call: ToolCall) {
    const name = call.function?.name ?? call.name ?? '';
    const args = parseArguments(call.function?.arguments ?? call.arguments);
    this.deps.log('tool', { name });
    const started = Date.now();
    const outcome = await this.deps.handlers.run(name, args);
    this.deps.log('tool done', { name, ms: Date.now() - started });
    if (outcome.refused) this.deps.log('publish refused', { reason: outcome.refused });
    if (outcome.after === 'countdown') this.deps.log('publish confirmed');
    if (this.finished) return;
    this.deliver(name, outcome);
  }

  private deliver(name: string, outcome: ToolOutcome) {
    const { call } = this.deps;
    if (outcome.after === 'end') return this.stop('agent');
    if (outcome.after === 'signIn') return this.stop('signIn');
    if (outcome.speak) this.speak(outcome.speak);
    call?.addMessage(`Result of ${name}: ${outcome.result}`, outcome.respond);
    if (outcome.after === 'countdown') {
      // The five seconds start once the "Posting in five seconds" notice has been spoken.
      this.announcementStarted = false;
      this.countdownArmed = this.deps.schedule(() => this.startCountdown(), COUNTDOWN_FALLBACK_MS);
    }
  }

  private startCountdown() {
    if (!this.countdownArmed) return;
    this.countdownArmed();
    this.countdownArmed = null;
    this.deps.handlers.publisher.startCountdown();
  }

  private finish(reason: EndReason) {
    if (this.finished) return;
    this.finished = true;
    this.live = false;
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.stopQuiet();
    this.openMicrophone?.();
    this.cancelWaitForWords();
    this.voiceSilenced?.();
    this.offMode?.();
    const cancelled = this.deps.handlers.publisher.cancelPending();
    this.deps.log('exit', { reason, cancelledPending: !!cancelled });
    this.deps.status('ended');
    const message = reason === 'silence' && this.mode === 'pushToTalk' ? agentMessages.silencePushToTalk : EXIT_MESSAGES[reason];
    this.deps.exit(reason, `${cancelled ? agentMessages.notSent : ''}${message}`);
  }
}


type ToolCall = { id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } };

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw || '{}');
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}
