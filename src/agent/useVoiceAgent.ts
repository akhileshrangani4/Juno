import { useEffect, useRef, useState } from 'react';

import { actionHistory } from '@/actions/history';
import { loadedComments, readComments } from '@/comments/commentsControl';
import { createCameraTools, describePendingPhoto } from '@/camera/agentTools';
import { move, type FeedState, type MoveOutcome } from '@/feed/feedState';
import { haptic } from '@/feedback/haptics';
import type { Narrator } from '@/narration/Narrator';
import { cameraModule } from '@/camera/native';
import { descriptionCache, earcons } from '@/narration/postNarration';
import { useSession } from '@/session/SessionContext';
import type { Post } from '@/social/types';
import { secureStore } from '@/storage/keyValueStore';

import { AgentSession, ConversationLog, type AgentStatus, type EndReason } from './AgentSession';
import { agentMessages } from './agentMessages';
import { buildAssistant } from './assistant';
import { convexMemoryAudience, createConvexMemory } from './convexMemory';
import { createMemoryAccess } from './memoryAccess';
import { MemorySignInNeededError } from './memoryClient';
import { createMemoryOffer } from './memoryOffer';
import { ensureMicrophone } from './microphone';
import { detailFor } from './narrationAdapter';
import { narrationSettings } from './narrationSettings';
import { describeAccount, describeFocus, describeMemories, describeSettings } from './postContext';
import { createToolHandlers } from './toolHandlers';
import { listeningMode, withPushToTalk, type TalkHold } from './listeningMode';
import { createVoiceCall } from './vapiCall';

const MEMORY_TIMEOUT_MS = 2500;

// Release builds only print errors to the device log, so test builds (the ones with the dev deep link) log
// the call lifecycle as errors to make it visible in the phone's logs. No transcript text is ever logged.
const logLine = process.env.EXPO_PUBLIC_DEV_AGENT_LINK === '1' ? console.error : console.log;

const schedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

function speakAndWait(narrator: Narrator, text: string): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = narrator.onDone(done);
    const timer = setTimeout(done, 4000 + text.length * 80);
    narrator.speak(text);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

type Feed = { state: FeedState; go(direction: 'next' | 'previous'): MoveOutcome };

export function useVoiceAgent({
  active,
  post,
  feed,
  narrator,
  onExit,
}: {
  active: boolean;
  post: Post | null;
  feed: Feed;
  narrator: Narrator;
  onExit(reason: EndReason, message: string): void;
}): { status: AgentStatus | null; say(text: string): boolean; notify(text: string, speak?: string): void; talk(): TalkHold | undefined; talking: boolean } {
  const { provider, account } = useSession();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [talking, setTalking] = useState(false);
  const latest = useRef({ post, feed, narrator, onExit, account });
  const session = useRef<AgentSession | null>(null);
  const talkHold = useRef<{ talk(): TalkHold | undefined } | null>(null);

  useEffect(() => {
    latest.current = { post, feed, narrator, onExit, account };
  });

  useEffect(() => {
    if (!active) return;
    const publicKey = process.env.EXPO_PUBLIC_VAPI_PUBLIC_KEY;
    const conversation = new ConversationLog();
    const access = createMemoryAccess({
      store: secureStore,
      account: () => latest.current.account,
      serviceAuth: (request) => provider.serviceAuth(request),
      audience: convexMemoryAudience,
      now: Date.now,
    });
    const memory = createConvexMemory(access, secureStore);
    const memoryOffer = memory ? createMemoryOffer(secureStore, memory, () => latest.current.account) : null;
    const pushToTalk = publicKey
      ? withPushToTalk(createVoiceCall(publicKey), listeningMode, {
          cue: (on) => {
            // The call's audio session records, and iOS drops haptics while an app records unless it opts in.
            const haptics = cameraModule?.allowHapticsDuringRecording(true) ?? null;
            haptic(on ? 'talkStart' : 'talkEnd');
            earcons.play(on ? 'talkStart' : 'talkEnd');
            setTalking(on);
            if (on) logLine(`[agent] haptics during recording=${String(haptics)}`);
          },
          openWhile: () => handlers.publisher.busy,
          schedule,
          now: Date.now,
          log: (event, detail) => logLine(`[agent] ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}`),
        })
      : null;
    talkHold.current = pushToTalk;
    const handlers = createToolHandlers({
      listening: listeningMode,
      provider,
      account: () => latest.current.account,
      focused: () => latest.current.post,
      move: (direction) => {
        const { state, go } = latest.current.feed;
        const { index } = move(state, direction);
        const outcome = go(direction);
        return { outcome, post: outcome === 'moved' ? (state.posts[index] ?? null) : null };
      },
      description: (target, detail, options) => descriptionCache.request(target, detail, options),
      cachedDescription: (target, detail) => descriptionCache.peek(target, detail),
      loadedReplies: (target) => loadedComments(target.uri),
      replies: (target) => readComments(target.uri),
      history: actionHistory,
      camera: createCameraTools(),
      mayNeedTranslation: (target) => descriptionCache.mayNeedTranslation(target),
      translationState: (target, detail) => descriptionCache.translationState(target, detail),
      settings: narrationSettings,
      memory,
      memoryOffer,
      conversation,
      notify: (text, speak) => session.current?.notify(text, speak),
      schedule,
      newId: () => Math.random().toString(36).slice(2, 8),
      now: () => new Date(),
    });
    const current = new AgentSession({
      call: pushToTalk?.call ?? null,
      handlers,
      conversation,
      microphone: () => ensureMicrophone((text) => speakAndWait(latest.current.narrator, text)).catch(() => 'denied' as const),
      assistant: async () => {
        const focus = latest.current.post;
        const [memories, offer, description] = await Promise.all([
          memory ? withTimeout(memory.list().catch((error: unknown) => (error instanceof MemorySignInNeededError ? ('signInNeeded' as const) : null)), MEMORY_TIMEOUT_MS) : Promise.resolve(null),
          memoryOffer ? withTimeout(memoryOffer.prepare(), MEMORY_TIMEOUT_MS) : Promise.resolve(null),
          focus ? Promise.resolve(descriptionCache.peek(focus, detailFor('full', narrationSettings.get()))) : Promise.resolve(null),
        ]);
        const photo = describePendingPhoto();
        if (!offer || photo) memoryOffer?.withdraw();
        return buildAssistant({
          account: describeAccount(latest.current.account),
          settings: describeSettings(narrationSettings.get()),
          memories: describeMemories(memories),
          focus: describeFocus(focus, description),
          memoryOffer: photo ? null : offer,
          photo,
        }, listeningMode.get() === 'pushToTalk');
      },
      status: setStatus,
      connecting: () => {
        haptic('agentConnecting');
        latest.current.narrator.speak(agentMessages.connecting);
      },
      listening: () => {
        latest.current.narrator.stop();
        haptic('agentAwake');
      },
      exit: (reason, message) => {
        haptic(reason === 'failed' || reason === 'micDenied' || reason === 'notConfigured' ? 'agentFailed' : 'agentAsleep');
        latest.current.onExit(reason, message);
      },
      schedule,
      now: Date.now,
      log: (event, detail) => logLine(`[agent] ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}`),
    });
    session.current = current;
    current.focusChanged(latest.current.post);
    void current.start();
    return () => {
      current.stop('user');
      session.current = null;
      pushToTalk?.dispose();
      talkHold.current = null;
      setTalking(false);
    };
  }, [active, provider]);

  useEffect(() => {
    session.current?.focusChanged(post);
  }, [post]);

  return {
    status: active ? status : null,
    say: (text) => session.current?.say(text) ?? false,
    notify: (text, speak) => session.current?.notify(text, speak),
    talk: () => talkHold.current?.talk(),
    talking: active && talking,
  };
}
