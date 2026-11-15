import type { Post } from '@/social/types';

import { agentMessages } from './agentMessages';
import { AgentVoice } from './agentVoice';
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
    deps.log('connected');
    deps.status('listening');
    deps.listening();
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
    const heard = this.deps.handlers.heard(transcript);
    if (!heard) return;
    this.countdownArmed?.();
    this.countdownArmed = null;
    this.deps.log(heard.kind === 'held' ? 'held from transcript' : 'undone from transcript');
    this.speak(heard.speak);
    this.deps.call?.addMessage(heard.message, false);
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
    this.deps.call?.say(text);
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
    const cancelled = this.deps.handlers.publisher.cancelPending();
    this.deps.log('exit', { reason, cancelledPending: !!cancelled });
    this.deps.status('ended');
    this.deps.exit(reason, `${cancelled ? agentMessages.notSent : ''}${EXIT_MESSAGES[reason]}`);
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
