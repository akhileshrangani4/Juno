import { useEffect, useRef, useState } from 'react';

import { move, type FeedState, type MoveOutcome } from '@/feed/feedState';
import { haptic } from '@/feedback/haptics';
import type { Narrator } from '@/narration/Narrator';
import { descriptionCache } from '@/narration/postNarration';
import { useSession } from '@/session/SessionContext';
import type { Post } from '@/social/types';
import { secureStore } from '@/storage/keyValueStore';

import { AgentSession, ConversationLog, type AgentStatus, type EndReason } from './AgentSession';
import { agentMessages } from './agentMessages';
import { buildAssistant } from './assistant';
import { createConvexMemory } from './convexMemory';
import { memoryIdentity } from './identity';
import { ensureMicrophone } from './microphone';
import { detailFor } from './narrationAdapter';
import { narrationSettings } from './narrationSettings';
import { describeAccount, describeFocus, describeMemories, describeSettings } from './postContext';
import { createToolHandlers } from './toolHandlers';
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
}): { status: AgentStatus | null; say(text: string): boolean } {
  const { provider, account } = useSession();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const latest = useRef({ post, feed, narrator, onExit, account });
  const session = useRef<AgentSession | null>(null);

  useEffect(() => {
    latest.current = { post, feed, narrator, onExit, account };
  });

  useEffect(() => {
    if (!active) return;
    const publicKey = process.env.EXPO_PUBLIC_VAPI_PUBLIC_KEY;
    const conversation = new ConversationLog();
    const memory = createConvexMemory(() => memoryIdentity(secureStore, latest.current.account));
    const handlers = createToolHandlers({
      provider,
      account: () => latest.current.account,
      focused: () => latest.current.post,
      move: (direction) => {
        const { state, go } = latest.current.feed;
        const { index } = move(state, direction);
        const outcome = go(direction);
        return { outcome, post: outcome === 'moved' ? (state.posts[index] ?? null) : null };
      },
      description: (target, detail) => descriptionCache.request(target, detail),
      settings: narrationSettings,
      memory,
      conversation,
      notify: (text, speak) => session.current?.notify(text, speak),
      schedule,
      newId: () => Math.random().toString(36).slice(2, 8),
      now: () => new Date(),
    });
    const current = new AgentSession({
      call: publicKey ? createVoiceCall(publicKey) : null,
      handlers,
      conversation,
      microphone: () => ensureMicrophone((text) => speakAndWait(latest.current.narrator, text)).catch(() => 'denied' as const),
      assistant: async () => {
        const focus = latest.current.post;
        const [memories, description] = await Promise.all([
          memory ? withTimeout(memory.list(), MEMORY_TIMEOUT_MS) : Promise.resolve(null),
          focus ? Promise.resolve(descriptionCache.peek(focus, detailFor('full', narrationSettings.get()))) : Promise.resolve(null),
        ]);
        return buildAssistant({
          account: describeAccount(latest.current.account),
          settings: describeSettings(narrationSettings.get()),
          memories: describeMemories(memories),
          focus: describeFocus(focus, description),
        });
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
    };
  }, [active, provider]);

  useEffect(() => {
    session.current?.focusChanged(post);
  }, [post]);

  return { status: active ? status : null, say: (text) => session.current?.say(text) ?? false };
}
