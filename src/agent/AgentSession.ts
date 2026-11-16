import type { Post } from '@/social/types';

import { agentMessages } from './agentMessages';
import { AgentVoice, type Attribution } from './agentVoice';
import { describeFocus } from './postContext';
import type { Conversation, ToolHandlers, ToolOutcome } from './toolHandlers';
import type { VapiMessage, VoiceCall } from './voiceCall';

export type EndReason = 'user' | 'agent' | 'silence' | 'maxDuration' | 'dropped' | 'failed' | 'micDenied' | 'notConfigured' | 'signIn';

export type AgentStatus = 'starting' | 'connecting' | 'listening' | 'ended';

export const CONNECT_TIMEOUT_MS = 20_000;
export const COUNTDOWN_FALLBACK_MS = 6_000;


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
      return this.finish('failed');
    }
    this.abandonConnect = null;
    if (this.finished) return;
    this.live = true;
    deps.log('connected');
    deps.status('listening');
    deps.listening();
  }

  stop(reason: EndReason = 'user'): void {
    this.finish(reason);
  }

  // Something finished outside a tool call (a post was sent). With speak, the app says it word for word and the
  // model only hears about it; otherwise the model is asked to tell the user.
  notify(text: string, speak?: string): void {
    if (!this.live) return;
    if (speak) this.speak(speak);
    this.deps.call?.addMessage(text, !speak);
  }

  // A draft waiting for its answer, or a send counting down or in flight: gestures leave it alone.
  get draftInPlay(): boolean {
    const { publisher } = this.deps.handlers;
    return publisher.currentDraft !== null || publisher.busy;
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
    // A failed call start from Vapi's API carries the parsed response body as error (it names what was refused).
    const body = typeof error === 'object' && error !== null && 'error' in error && error.error ? JSON.stringify(error.error).slice(0, 300) : undefined;
    this.deps.log('call error', { error: error instanceof Error ? error.message : typeof error === 'object' ? JSON.stringify(error).slice(0, 200) : String(error), ...(body ? { body } : {}) });
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
    const confirmed = this.deps.handlers.confirmFromWords(transcript);
    if (confirmed) {
      if (confirmed.refused) this.deps.log('publish refused', { reason: confirmed.refused, by: 'words' });
      else this.deps.log('publish confirmed', { by: 'words' });
      return this.deliver('publish_draft', confirmed);
    }
    const heard = this.deps.handlers.heard(transcript);
    if (!heard) return;
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.deps.log(heard.kind === 'held' ? 'held from transcript' : 'undone from transcript');
    this.speak(heard.speak, heard.readBack, true);
    this.deps.call?.addMessage(heard.message, false);
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
    this.voice.appSays(text, readBack, interrupt);
    this.deps.call?.say(text, interrupt);
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
    // Leaving at any point, even mid-connect, tears the call down so the next wake starts cleanly.
    this.deps.call?.stop();
    this.abandonConnect?.();
    this.abandonConnect = null;
    this.countdownArmed?.();
    this.countdownArmed = null;
    // Every countdown, timer and confirmation ends here: nothing is published once the user can't hear it or undo it.
    const { cancelled, dropped } = this.deps.handlers.close();
    this.deps.log('exit', { reason, cancelledPending: !!cancelled, droppedDraft: !!dropped });
    this.deps.status('ended');
    this.deps.exit(reason, `${cancelled ? agentMessages.notSent : dropped ? agentMessages.draftNotSent : ''}${EXIT_MESSAGES[reason]}`);
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
