import { APP_NAME } from '@/appName';

import { buildSystemPrompt, type PromptContext } from './systemPrompt';
import { vapiTools } from './tools';

// The assistant is a transient configuration built on the phone at every call start, so the post in focus,
// the account state and the memories go straight into the prompt, and the prompt and tools ship and are
// reviewed with the app. Nothing here is secret.

export const SILENCE_TIMEOUT_SECONDS = 30;
export const MAX_DURATION_SECONDS = 600;
export const FIRST_MESSAGE = "I'm listening.";

// The model behind the voice agent, chosen by measuring tool use, publish safety and time to first word against
// the other models Vapi offers (docs/building.md, "The voice agent's model"). Reasoning stays off: any effort above
// none adds time before the first word, and OpenAI then refuses the temperature. The fast tier costs twice as much
// per token and brings the first word back close to gpt-4.1's.
export const AGENT_MODEL = 'gpt-5.6-sol';

// assistant.speechStarted names who is speaking each turn (the app's say() or the model); see agentVoice.ts.
export const clientMessages = ['tool-calls', 'transcript', 'status-update', 'speech-update', 'assistant.speechStarted'] as const;

export function buildAssistant(context: PromptContext) {
  return {
    name: `${APP_NAME} voice agent`,
    firstMessage: context.memoryOffer ? `${FIRST_MESSAGE} ${context.memoryOffer}` : FIRST_MESSAGE,
    firstMessageMode: 'assistant-speaks-first' as const,
    model: {
      provider: 'openai' as const,
      model: AGENT_MODEL,
      reasoningEffort: 'none' as const,
      serviceTier: 'fast' as const,
      temperature: 0.2,
      messages: [{ role: 'system' as const, content: buildSystemPrompt(context) }],
      tools: vapiTools,
    },
    voice: { provider: 'vapi' as const, voiceId: 'Elliot' },
    transcriber: { provider: 'deepgram' as const, model: 'nova-3', language: 'en' as const },
    silenceTimeoutSeconds: SILENCE_TIMEOUT_SECONDS,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    messagePlan: {
      idleMessages: ["Are you still there? I'll go to sleep soon if it stays quiet."],
      idleMessageMaxSpokenCount: 1,
      idleTimeoutSeconds: 17,
    },
    backgroundSound: 'off' as const,
    clientMessages: [...clientMessages],
    serverMessages: [],
  };
}

export type AssistantConfig = ReturnType<typeof buildAssistant>;
