import { APP_NAME } from '@/appName';

import { buildSystemPrompt, type PromptContext } from './systemPrompt';
import { vapiTools } from './tools';

// The assistant is a transient configuration built on the phone at every call start, so the post in focus,
// the account state and the memories go straight into the prompt, and the prompt and tools ship and are
// reviewed with the app. Nothing here is secret.

export const SILENCE_TIMEOUT_SECONDS = 30;
export const MAX_DURATION_SECONDS = 600;
export const FIRST_MESSAGE = "I'm listening.";

// Words the transcriber should expect. On a real call Deepgram heard "post" at the start of an utterance as
// "host" ("Host, hello again.", "Host it."), so the agent missed drafts and "post it" never confirmed.
export const KEYTERMS = [APP_NAME, 'post', 'post it', 'repost', 'reply', 'undo', 'cancel'] as const;

// The model behind the voice agent, measured against the newer models Vapi offers (docs/building.md, "The voice
// agent's model"). A GPT-5.x or GPT-6 model also needs reasoningEffort: 'none' here, or OpenAI refuses the
// temperature and the first word comes later.
export const AGENT_MODEL = 'gpt-4.1';

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
      temperature: 0.2,
      messages: [{ role: 'system' as const, content: buildSystemPrompt(context) }],
      tools: vapiTools,
    },
    voice: { provider: 'vapi' as const, voiceId: 'Elliot' },
    transcriber: { provider: 'deepgram' as const, model: 'nova-3', language: 'en' as const, keyterm: [...KEYTERMS] },
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
