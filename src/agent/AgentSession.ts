import type { Post } from '@/social/types';

import { agentMessages } from './agentMessages';
import { AgentVoice, type Attribution } from './agentVoice';
import { describeFocus } from './postContext';
import type { ListeningMode } from './listeningMode';
import type { Conversation, Heard, ToolHandlers, ToolOutcome } from './toolHandlers';
import type { VapiMessage, VoiceCall } from './voiceCall';

export type EndReason = 'user' | 'agent' | 'silence' | 'maxDuration' | 'dropped' | 'failed' | 'micDenied' | 'notConfigured' | 'signIn';

export type AgentStatus = 'starting' | 'connecting' | 'listening' | 'ended';

export const CONNECT_TIMEOUT_MS = 20_000;
export const COUNTDOWN_FALLBACK_MS = 6_000;

// The app, not Vapi, decides when a quiet call goes to sleep, since in push to talk Vapi hears silence whenever no
// finger is down. Quiet is counted from the last thing anyone said, or the last release, and stands still while
// anyone speaks or a finger is held. Push to talk waits longer: the user has to find the screen and hold it first.
export const QUIET_LIMIT_MS: Record<ListeningMode, number> = { handsFree: 30_000, pushToTalk: 60_000 };
// After a release in which the user was heard speaking while a send was paused, how long the app waits for their
// words before treating them as unclear, which holds the send.
export const WORDS_AFTER_RELEASE_MS = 3000;
// A press silences the agent's voice; it comes back when that speech has stopped, or after this long at most.
export const VOICE_BACK_AFTER_MS = 15_000;


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
  schedule(run: () => void, ms: number): () => void;
  now(): number;
  log(event: string, detail?: Record<string, unknown>): void;
  // The listening mode the user chose (listeningMode.ts).
  listeningMode: { get(): ListeningMode; subscribe(listener: (mode: ListeningMode) => void): () => void };
  // Push to talk's haptic and tone; returns how long the tone plays, so the microphone opens after it.
  cue(cue: 'talkStart' | 'talkEnd'): number;
};

export class ConversationLog implements Conversation {
  private readonly utterances: string[] = [];
  private readonly listeners = new Set<() => void>();

  add(utterance: string) {
    this.utterances.push(utterance.trim());
    this.listeners.forEach((listener) => listener());
  }

  onUtterance(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
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
  // Gives up waiting for the call to connect, with its timeout, when the session ends first.
  private abandonConnect: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly voice: AgentVoice;
  private mode: ListeningMode = 'handsFree';
  private offMode: (() => void) | null = null;
  private holding = false;
  private spokeWhileHolding = false;
  private openMicrophone: (() => void) | null = null;
  private waitForWords: (() => void) | null = null;
  private assistantSpeaking = false;
  private userSpeaking = false;
  private voiceSilenced: (() => void) | null = null;
  private quiet: (() => void) | null = null;

  constructor(private readonly deps: SessionDeps) {
    this.voice = new AgentVoice(deps.now);
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
        this.abandonConnect = () => {
          cancel();
          resolve();
        };
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
      if (this.finished) return;
      deps.log('connect failed', { error: error instanceof Error ? error.message : String(error) });
      deps.call.stop();
      return this.finish('failed');
    }
    this.abandonConnect = null;
    if (this.finished) return;
    this.live = true;
    this.mode = deps.listeningMode.get();
    this.muteForMode();
    this.offMode = deps.listeningMode.subscribe((mode) => this.modeChanged(mode));
    deps.log('connected', { mode: this.mode });
    deps.status('listening');
    deps.listening();
    this.restartQuiet();
  }

  // A finger came down and stayed (the talk hold). A press silences the agent at once in either mode. In push to
  // talk it also pauses a send that is counting down, and the microphone opens once the rising tone has played, so
  // the tone is never heard as the user's speech.
  holdStart(): void {
    if (!this.live || this.holding) return;
    if (this.assistantSpeaking) this.silenceVoice();
    if (this.mode !== 'pushToTalk') return;
    this.holding = true;
    this.spokeWhileHolding = false;
    this.stopQuiet();
    this.cancelWaitForWords();
    if (this.deps.handlers.publisher.pauseCountdown()) this.deps.log('countdown paused');
    this.openMicrophone = this.deps.schedule(() => {
      this.openMicrophone = null;
      this.deps.call?.setMuted(false);
      this.deps.log('talk hold: microphone open');
    }, this.deps.cue('talkStart'));
  }

  // The finger lifted, or the system took the touch (cancelled). The microphone closes before the falling tone. A
  // paused send resumes, unless the user spoke while holding: then the app waits for their words, which may be undo.
  holdEnd(cancelled = false): void {
    if (!this.holding) return;
    this.holding = false;
    this.openMicrophone?.();
    this.openMicrophone = null;
    this.deps.call?.setMuted(true);
    this.deps.log('talk hold: microphone closed', cancelled ? { cancelled } : undefined);
    this.deps.cue('talkEnd');
    if (this.voiceSilenced && !this.assistantSpeaking) this.restoreVoice();
    this.restartQuiet();
    if (!this.deps.handlers.publisher.countdownPaused) return;
    if (!this.spokeWhileHolding) return this.resumeCountdown();
    this.waitForWords = this.deps.schedule(() => this.wordsNeverCame(), WORDS_AFTER_RELEASE_MS);
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
    if (!this.live) return;
    const dropped = this.deps.handlers.focusMoved(post);
    if (dropped) this.speak(dropped, undefined, true);
    this.deps.call?.addMessage(`Focus changed.${dropped ? ` The app dropped the pending reply or repost, which was for the previous post, and told the user.` : ''} The post in focus is now: ${describeFocus(post)}`, false);
  }

  private onError(error: unknown) {
    this.deps.log('call error', { error: error instanceof Error ? error.message : typeof error === 'object' ? JSON.stringify(error).slice(0, 200) : String(error) });
    if (this.live) this.finish('dropped');
  }

  // Once the session has finished nothing it hears counts: a late transcript can't confirm or hold anything.
  private onMessage(message: VapiMessage) {
    if (this.finished) return;
    switch (message.type) {
      case 'transcript':
        if (message.transcriptType !== 'final' || typeof message.transcript !== 'string') return;
        if (message.role === 'user') this.onUserSaid(message.transcript);
        if (message.role === 'assistant') this.onAssistantSaid(message.transcript);
        return;
      case 'tool-calls':
        for (const call of (message.toolCallList as ToolCall[] | undefined) ?? []) this.queue = this.queue.then(() => this.runTool(call));
        return;
      case 'assistant.speechStarted':
        this.heardSpeech(this.voice.sourceReported(message.source, message.turn));
        return;
      case 'speech-update':
        if (message.role === 'user') return this.userSpeech(message.status === 'started');
        if (message.role === 'assistant') this.assistantSpeech(message.status === 'started');
        if (message.role === 'assistant' && message.status === 'started') this.heardSpeech(this.voice.speechStarted(message.turn));
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
    this.heardSpeech(this.voice.settle());
    this.deps.conversation.add(transcript);
    if (this.holding) this.spokeWhileHolding = true;
    this.restartQuiet();
    const confirmed = this.deps.handlers.confirmFromWords(transcript);
    if (confirmed) {
      if (confirmed.refused) this.deps.log('publish refused', { reason: confirmed.refused, by: 'words' });
      else this.deps.log('publish confirmed', { by: 'words' });
      return this.deliver('publish_draft', confirmed);
    }
    const heard = this.deps.handlers.heard(transcript);
    if (heard) return this.answerDuringCountdown(heard);
    if (!this.holding) this.resumeCountdown();
  }

  private answerDuringCountdown(heard: Heard) {
    this.cancelWaitForWords();
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.deps.log(heard.kind === 'held' ? 'held from transcript' : 'undone from transcript');
    this.speak(heard.speak, heard.readBack, true);
    this.deps.call?.addMessage(heard.message, false);
  }

  // The user was heard speaking during a hold that paused the send, and no words came: not a yes, so it is held.
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
    this.deps.call?.setMuted(this.mode === 'pushToTalk');
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
  }

  private userSpeech(started: boolean) {
    this.userSpeaking = started;
    if (!started) return this.restartQuiet();
    if (this.holding) this.spokeWhileHolding = true;
    this.stopQuiet();
  }

  private assistantSpeech(started: boolean) {
    this.assistantSpeaking = started;
    if (started) return this.stopQuiet();
    if (this.voiceSilenced && !this.holding) this.restoreVoice();
    this.restartQuiet();
  }

  private restartQuiet() {
    this.stopQuiet();
    if (!this.live || this.holding || this.userSpeaking || this.assistantSpeaking) return;
    this.quiet = this.deps.schedule(() => this.stop('silence'), QUIET_LIMIT_MS[this.mode]);
  }

  private stopQuiet() {
    this.quiet?.();
    this.quiet = null;
  }

  private onAssistantSaid(transcript: string) {
    this.heardSpeech(this.voice.attribute(transcript));
  }

  // The model's own words (not the app's, which go through speak) void a read-back the user hasn't answered, and a
  // read-back spoken to the end lets an explicit command confirm that draft. While one is waiting for an answer,
  // every assistant transcript is logged with who it was put down to, never its words.
  private heardSpeech(attribution: Attribution | null) {
    if (!attribution) return;
    const { speaker, by, source, turn, finished } = attribution;
    if (this.deps.handlers.publisher.awaitingAnswer) this.deps.log('assistant speech during read-back', { speaker, by, source, turn });
    if (speaker === 'model' && this.deps.handlers.assistantSaid()) this.deps.log('yes voided by assistant speech', { by, source, turn });
    for (const draftId of finished) {
      this.deps.handlers.readBackHeard(draftId);
      this.deps.log('read-back heard in full', { by, source, turn });
    }
  }

  // Everything the app says in the agent's voice goes through here, so its transcript is known to be the app's. A
  // tool's outcome interrupts: Vapi drops anything the model is saying or about to say, and says this now.
  private speak(text: string, readBack?: string, interrupt = false) {
    const silenced = this.voiceSilenced !== null;
    if (silenced) this.restoreVoice();
    this.voice.appSays(text, readBack, interrupt || silenced);
    this.deps.call?.say(text, interrupt || silenced);
  }

  private async runTool(call: ToolCall) {
    const name = call.function?.name ?? call.name ?? '';
    const args = parseArguments(call.function?.arguments ?? call.arguments);
    this.deps.log('tool', { name });
    const started = Date.now();
    const outcome = await this.deps.handlers.run(name, args);
    this.deps.log('tool done', { name, ms: Date.now() - started });
    if (outcome.refused) this.deps.log(outcome.refused === 'awaitingAnswer' ? 'tool refused' : 'publish refused', { reason: outcome.refused });
    if (outcome.after === 'countdown') this.deps.log('publish confirmed');
    if (this.finished) return;
    this.deliver(name, outcome);
  }

  private deliver(name: string, outcome: ToolOutcome) {
    const { call } = this.deps;
    if (this.finished) return;
    if (outcome.after === 'end') return this.stop('agent');
    if (outcome.after === 'signIn') return this.stop('signIn');
    if (outcome.speak) this.speak(outcome.speak, outcome.readBack, true);
    call?.addMessage(`Result of ${name}: ${outcome.result}`, outcome.respond);
    if (outcome.after === 'countdown') {
      // The five seconds start once the "Posting in five seconds" notice has been spoken.
      this.announcementStarted = false;
      this.countdownArmed = this.deps.schedule(() => this.startCountdown(), COUNTDOWN_FALLBACK_MS);
    }
  }

  private startCountdown() {
    if (!this.countdownArmed || this.finished) return;
    this.countdownArmed();
    this.countdownArmed = null;
    this.deps.handlers.publisher.startCountdown();
  }

  private finish(reason: EndReason) {
    if (this.finished) return;
    this.finished = true;
    this.live = false;
    this.abandonConnect?.();
    this.abandonConnect = null;
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.stopQuiet();
    this.openMicrophone?.();
    this.cancelWaitForWords();
    this.voiceSilenced?.();
    this.offMode?.();
    // Every countdown, timer and confirmation ends here: nothing is published once the user can't hear it or undo it.
    const { cancelled, dropped } = this.deps.handlers.close();
    this.deps.log('exit', { reason, cancelledPending: !!cancelled, droppedDraft: !!dropped });
    this.deps.status('ended');
    const message = reason === 'silence' && this.mode === 'pushToTalk' ? agentMessages.silencePushToTalk : EXIT_MESSAGES[reason];
    this.deps.exit(reason, `${cancelled ? agentMessages.notSent : dropped ? agentMessages.draftNotSent : ''}${message}`);
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
