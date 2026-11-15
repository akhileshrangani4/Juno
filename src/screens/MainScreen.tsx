import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenReader } from '@/accessibility/useScreenReader';
import type { AgentStatus, EndReason } from '@/agent/AgentSession';
import { onDevWake } from '@/agent/devWake';
import { useVoiceAgent } from '@/agent/useVoiceAgent';
import { cameraMessages } from '@/camera/cameraMessages';
import { openCamera, registerCameraHost, setPendingPhoto } from '@/camera/host';
import { haptic } from '@/feedback/haptics';
import { useFeed } from '@/feed/useFeed';
import type { CircleDirection } from '@/gestures/circle';
import { createRateLimiter } from '@/gestures/rateLimit';
import { messages } from '@/narration/buildNarration';
import { useNarrationPreferences, usePostNarrator } from '@/narration/postNarration';
import { applyNarrationAction, isNarrationAction, narrationActions } from '@/narration/requests';
import { useNarrator } from '@/narration/useNarrator';
import { DiscoverySurface as GestureSurface } from '@/onboarding/DiscoverySurface';
import { useSession } from '@/session/SessionContext';
import { colors, type } from '@/theme';

import { PostCard } from './PostCard';
import { surfaceActions, type Mode, type SurfaceActionName } from './surfaceActions';
import { playUnrecognizedCue } from './unrecognizedCue';

const STROKE_CUE_INTERVAL_MS = 2500;

const DIRECT_TOUCH = 'allowsDirectInteraction' as unknown as AccessibilityRole;

const AGENT_STATUS: Record<AgentStatus, string> = {
  starting: 'Waking up',
  connecting: 'Connecting',
  listening: 'Listening',
  ended: 'Going to sleep',
};

let mountedFeeds = 0;

export function MainScreen() {
  const { provider } = useSession();
  const narrator = useNarrator();
  const postNarrator = usePostNarrator();
  const screenReader = useScreenReader();
  const narrationPrefs = useNarrationPreferences();
  const { state, post, go } = useFeed(provider);
  const [mode, setMode] = useState<Mode>('scroll');
  const [narration, setNarration] = useState('');
  const prefix = useRef('');
  const [allowStrokeCue] = useState(() => createRateLimiter(STROKE_CUE_INTERVAL_MS));
  const [strokeCue, setStrokeCue] = useState(false);
  const strokeCueTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focused = useIsFocused();
  // True while the camera is open over the feed: the feed says nothing behind it.
  const covered = useRef(false);

  useEffect(() => () => clearTimeout(strokeCueTimer.current), []);

  const onAgentExit = (reason: EndReason, message: string) => {
    if (covered.current) narrator.speak(message);
    else prefix.current = message;
    setMode('scroll');
    if (reason === 'signIn') router.push('/sign-in');
  };
  const agent = useVoiceAgent({ active: mode === 'agent', post, feed: { state, go }, narrator, onExit: onAgentExit });
  const agentStatus = agent.status;

  useEffect(() => onDevWake(() => setMode('agent')), []);

  const status = post ? null : state.error ? messages.feedError : state.exhausted ? (state.stalled ? messages.unavailable : messages.empty) : messages.loadingFirst;

  useEffect(() => {
    mountedFeeds += 1;
    if (mountedFeeds > 1) console.warn(`${mountedFeeds} feed screens are mounted; expected one`);
    return () => {
      mountedFeeds -= 1;
    };
  }, []);

  useEffect(() => {
    if (!focused || covered.current) return;
    let cancelled = false;
    const show = (text: string) => {
      if (!cancelled) setNarration(text);
    };
    const say = (text: string) => {
      if (cancelled) return;
      show(text);
      narrator.speak(`${prefix.current} ${text}`.trim());
      prefix.current = '';
    };
    if (mode === 'agent') narrator.stop();
    else if (!post) say(status ?? '');
    else {
      postNarrator.focus(post, { prefix: prefix.current });
      prefix.current = '';
    }
    return () => {
      cancelled = true;
      if (covered.current) return;
      postNarrator.stop();
      narrator.stop();
    };
  }, [mode, post, status, narrator, postNarrator, focused]);

  useEffect(() => postNarrator.onScript(setNarration), [postNarrator]);
  useEffect(() => postNarrator.prefetch(state.posts.slice(state.index + 1)), [postNarrator, state.posts, state.index]);

  const step = (direction: 'next' | 'previous') => {
    const outcome = go(direction);
    if (outcome === 'moved') return haptic(direction);
    haptic('edge');
    if (!state.error) narrator.speak(outcome === 'atStart' ? messages.atStart : outcome === 'atEnd' ? messages.atEnd : outcome === 'unavailable' ? messages.noMore : messages.loading);
  };

  // While the agent is awake the call owns the audio: the app's messages go through the agent's voice, never
  // on-device speech, and before the call is live a haptic is the only answer.
  const tellInAgentMode = (text: string) => {
    if (!agent.say(text)) haptic('edge');
  };

  const switchMode = (next: Mode) => {
    if (next === mode) {
      haptic('edge');
      if (next === 'agent') agent.say(messages.alreadyAwake);
      else narrator.speak(messages.alreadyScrolling);
      return;
    }
    haptic(next === 'agent' ? 'agentAwake' : 'agentAsleep');
    if (next === 'scroll') prefix.current = messages.agentAsleep;
    setMode(next);
  };

  const agentLive = agentStatus === 'listening';
  const latest = useRef({ agentLive, agent, switchMode, mode });
  useEffect(() => {
    latest.current = { agentLive, agent, switchMode, mode };
  });

  // The camera opens over the feed as its own screen. Leaving it, the feed reads the same post again; keeping a
  // photo hands it to the voice agent's publishing flow, waking the agent if it is asleep.
  useEffect(
    () =>
      registerCameraHost({
        cover: () => {
          covered.current = true;
          postNarrator.stop();
        },
        agentLive: () => latest.current.agentLive,
        say: (text) => latest.current.agentLive && latest.current.agent.say(text),
        wakeAgent: () => latest.current.switchMode('agent'),
        sleepAgent: () => latest.current.switchMode('scroll'),
        keep: (photo) => {
          setPendingPhoto(photo);
          covered.current = false;
          router.back();
          const { agentLive: live, agent: current, switchMode: switchTo, mode: currentMode } = latest.current;
          if (live) return current.notify(cameraMessages.photoReadyForModel, cameraMessages.photoReady);
          prefix.current = '';
          if (currentMode !== 'agent') switchTo('agent');
        },
        closed: () => {
          covered.current = false;
          const { agentLive: live, agent: current } = latest.current;
          if (live) current.say(cameraMessages.backToFeed);
          else prefix.current = cameraMessages.backToFeed;
          router.back();
        },
        left: () => {
          covered.current = false;
          const { agentLive: live, agent: current } = latest.current;
          if (live) current.say(cameraMessages.backToFeed);
          else prefix.current = cameraMessages.backToFeed;
        },
      }),
    [postNarrator],
  );

  const onTapTop = () => (mode === 'scroll' ? step('previous') : tellInAgentMode(messages.gestures));
  const onTapBottom = () => (mode === 'scroll' ? step('next') : onAgentExit('signIn', 'Opening the sign-in screen.'));
  const onCircle = (direction: CircleDirection) => switchMode(direction === 'clockwise' ? 'agent' : 'scroll');
  const onUnrecognizedStroke = () =>
    playUnrecognizedCue({
      narrator,
      speaking: () => postNarrator.speaking(),
      allowSpeech: () => mode === 'scroll' && allowStrokeCue(),
      showHint: () => {
        setStrokeCue(true);
        clearTimeout(strokeCueTimer.current);
        strokeCueTimer.current = setTimeout(() => setStrokeCue(false), STROKE_CUE_INTERVAL_MS);
      },
    });

  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    switch (nativeEvent.actionName as SurfaceActionName) {
      case 'next':
      case 'increment':
        return step('next');
      case 'previous':
      case 'decrement':
        return step('previous');
      case 'reread':
        return mode === 'scroll' ? narrator.speak(narration) : tellInAgentMode(narration);
      case 'toggleAgent':
        return switchMode(mode === 'scroll' ? 'agent' : 'scroll');
      case 'instructions':
        return mode === 'scroll' ? narrator.speak(messages.gestures) : tellInAgentMode(messages.gestures);
      case 'account':
        return mode === 'scroll' ? router.push('/sign-in') : onTapBottom();
      case 'camera':
        return void openCamera();
    }
    if (isNarrationAction(nativeEvent.actionName)) {
      const message = applyNarrationAction(nativeEvent.actionName, screenReader);
      if (post && mode === 'scroll') postNarrator.focus(post, { prefix: message });
      else narrator.speak(message);
    }
  };

  const scrolling = mode === 'scroll';
  return (
    <SafeAreaView style={styles.screen}>
      <GestureSurface
        style={styles.surface}
        discoveryMode={mode}
        tapsEnabled
        onTapTop={onTapTop}
        onTapBottom={onTapBottom}
        onCircle={onCircle}
        onUnrecognizedStroke={onUnrecognizedStroke}
        accessible
        accessibilityRole={Platform.OS === 'ios' ? DIRECT_TOUCH : 'adjustable'}
        accessibilityLabel={scrolling ? 'Feed' : `Voice agent, ${AGENT_STATUS[agentStatus ?? 'starting'].toLowerCase()}`}
        accessibilityHint={
          scrolling
            ? 'Tap the bottom half for the next post, the top half for the previous post. Draw a clockwise circle to wake the agent.'
            : 'Tap the top half to hear the instructions, the bottom half for account settings. Draw a counter-clockwise circle to go back to scrolling.'
        }
        accessibilityValue={{ text: narration }}
        accessibilityActions={[...surfaceActions(mode, Platform.OS), ...(scrolling ? narrationActions(narrationPrefs, screenReader) : [])]}
        onAccessibilityTap={onTapBottom}
        onAccessibilityAction={onAccessibilityAction}
        onMagicTap={() => switchMode(scrolling ? 'agent' : 'scroll')}
        onAccessibilityEscape={() => switchMode('scroll')}>
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {scrolling ? '▲ Previous post' : '▲ Hear the instructions'}
        </Text>
        {!scrolling ? (
          <View style={styles.agentBar}>
            <Text style={[styles.agentTitle, { color: colors.agent }]} maxFontSizeMultiplier={type.maxScale}>
              Agent: {AGENT_STATUS[agentStatus ?? 'starting']}
            </Text>
          </View>
        ) : null}
        {post ? (
          <PostCard post={post} position={`${state.index + 1} of ${state.posts.length}${state.exhausted ? '' : '+'}`} />
        ) : (
          <View style={styles.panel}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {strokeCue ? messages.unrecognized : scrolling ? '▼ Next post' : '▼ Account settings'}
        </Text>
      </GestureSurface>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  surface: { flex: 1, padding: 12, gap: 8 },
  hint: { color: colors.muted, fontSize: type.label, fontWeight: '700', textAlign: 'center', paddingVertical: 6 },
  panel: { flex: 1, borderWidth: 6, borderColor: colors.focus, borderRadius: 24, backgroundColor: colors.surface, padding: 20, gap: 16, justifyContent: 'center' },
  agentBar: { borderWidth: 4, borderColor: colors.agent, borderRadius: 16, padding: 12 },
  agentTitle: { fontSize: type.title, fontWeight: '800', textAlign: 'center' },
  statusText: { color: colors.text, fontSize: type.body, lineHeight: type.bodyLineHeight, fontWeight: '600' },
});
