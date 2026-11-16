import { APP_NAME } from '@/appName';
import { cameraMessages } from '@/camera/cameraMessages';

import { buildSystemPrompt, type PromptContext } from './systemPrompt';
import { vapiTools } from './tools';

// The assistant is a transient configuration built on the phone at every call start, so the post in focus,
// the account state and the memories go straight into the prompt, and the prompt and tools ship and are
// reviewed with the app. Nothing here is secret.

export const SILENCE_TIMEOUT_SECONDS = 30;
export const MAX_DURATION_SECONDS = 600;
// In push to talk the microphone is muted between holds, so quiet is normal: the call waits five minutes, and the
// "are you still there" prompt four, before ending on silence. The maximum call length is the same.
export const PUSH_TO_TALK_SILENCE_SECONDS = 300;
export const PUSH_TO_TALK_IDLE_SECONDS = 240;
export const FIRST_MESSAGE = "I'm listening.";
// When the call starts because a photo was kept or chosen, the agent opens by asking for the post's words.
export const PHOTO_FIRST_MESSAGE = cameraMessages.photoReady;

// Words the transcriber should expect. On a real call Deepgram heard "post" at the start of an utterance as
// "host" ("Host, hello again.", "Host it."), so the agent missed drafts and "post it" never confirmed.
export const KEYTERMS = [APP_NAME, 'post', 'post it', 'repost', 'reply', 'undo', 'cancel'] as const;

// The model behind the voice agent, chosen by measuring tool use, publish safety and time to first word against
// gpt-4.1 (docs/building.md, "The voice agent's model"). Reasoning stays off, because any effort adds time before the
// first word and OpenAI then refuses the temperature; the fast tier keeps the first word close to gpt-4.1's.
export const AGENT_MODEL = 'gpt-5.6-sol';

// assistant.speechStarted names who is speaking each turn (the app's say() or the model); see agentVoice.ts.
export const clientMessages = ['tool-calls', 'transcript', 'status-update', 'speech-update', 'assistant.speechStarted'] as const;

export function buildAssistant(context: PromptContext, pushToTalk = false) {
  return {
    name: `${APP_NAME} voice agent`,
    firstMessage: context.photo ? PHOTO_FIRST_MESSAGE : context.memoryOffer ? `${FIRST_MESSAGE} ${context.memoryOffer}` : FIRST_MESSAGE,
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
    transcriber: { provider: 'deepgram' as const, model: 'nova-3', language: 'en' as const, keyterm: [...KEYTERMS] },
    silenceTimeoutSeconds: pushToTalk ? PUSH_TO_TALK_SILENCE_SECONDS : SILENCE_TIMEOUT_SECONDS,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    messagePlan: {
      idleMessages: ["Are you still there? I'll go to sleep soon if it stays quiet."],
      idleMessageMaxSpokenCount: 1,
      idleTimeoutSeconds: pushToTalk ? PUSH_TO_TALK_IDLE_SECONDS : 17,
    },
    backgroundSound: 'off' as const,
    clientMessages: [...clientMessages],
    serverMessages: [],
  };
}

export type AssistantConfig = ReturnType<typeof buildAssistant>;
