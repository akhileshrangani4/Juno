// The phone's side of a Vapi call, kept behind an interface so the agent session can be tested without
// native audio. vapiCall.native.ts implements it with Vapi's React Native SDK; vapiCall.ts is the web stub.

export type VapiMessage = { type?: string; [key: string]: unknown };

export type CallListener = {
  onMessage(message: VapiMessage): void;
  onEnd(): void;
  onError(error: unknown): void;
};

export interface VoiceCall {
  // Resolves when the phone has joined the call; rejects if it cannot connect.
  start(assistant: object, listener: CallListener): Promise<void>;
  stop(): void;
  // Speaks the text word for word in the agent's voice; interrupt drops whatever the agent is saying or is about to say.
  say(text: string, interrupt?: boolean): void;
  // Adds a system message to the conversation; triggerResponse asks the model to answer it.
  addMessage(content: string, triggerResponse: boolean): void;
}
