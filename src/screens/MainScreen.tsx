import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenReader } from '@/accessibility/useScreenReader';
import { actionHistory } from '@/actions/history';
import type { AgentStatus, EndReason } from '@/agent/AgentSession';
import { onDevWake } from '@/agent/devWake';
import { useVoiceAgent } from '@/agent/useVoiceAgent';
import { launchWake, wakeOnOpen } from '@/agent/wakeOnOpen';
import { cameraMessages } from '@/camera/cameraMessages';
import { openCamera, registerCameraHost, setPendingPhoto } from '@/camera/host';
import { registerCommentsController } from '@/comments/commentsControl';
import { useComments } from '@/comments/useComments';
import { haptic } from '@/feedback/haptics';
import { likeInFlight, likeUriOf, toggleLike, useLikeLedger, whose } from '@/feed/likes';
import { useFeed } from '@/feed/useFeed';
import type { CircleDirection } from '@/gestures/circle';
import { createRateLimiter } from '@/gestures/rateLimit';
import type { SwipeDirection } from '@/gestures/swipe';
import { authorName, messages } from '@/narration/buildNarration';
import { commentMessages, commentsEntry, likeFailure, likeUnconfirmed, replyPosition } from '@/narration/comments';
import { earcons, useNarrationPreferences, usePostNarrator } from '@/narration/postNarration';
import { applyNarrationAction, isNarrationAction, narrationActions, replyScripts } from '@/narration/requests';
import { useNarrator } from '@/narration/useNarrator';
import { DiscoverySurface as GestureSurface } from '@/onboarding/DiscoverySurface';
import { useSession } from '@/session/SessionContext';
import { colors, type } from '@/theme';

import { PostCard } from './PostCard';
import { surfaceActions, type Mode, type SurfaceActionName } from './surfaceActions';
import { playUnrecognizedCue } from './unrecognizedCue';

const STROKE_CUE_INTERVAL_MS = 2500;
const LOADING_ANNOUNCE_MS = 700;

const DIRECT_TOUCH = 'allowsDirectInteraction' as unknown as AccessibilityRole;

const AGENT_STATUS: Record<AgentStatus, string> = {
  starting: 'Waking up',
  connecting: 'Connecting',
  listening: 'Listening',
  ended: 'Going to sleep',
};

let mountedFeeds = 0;

export function MainScreen() {
  const { provider, account } = useSession();
  const narrator = useNarrator();
  const postNarrator = usePostNarrator();
  const screenReader = useScreenReader();
  const narrationPrefs = useNarrationPreferences();
  const { state, post, go } = useFeed(provider);
  const comments = useComments(provider);
  const { thread, reply } = comments;
  const [mode, setMode] = useState<Mode>('scroll');
  const [narration, setNarration] = useState('');
  const prefix = useRef('');
  const entering = useRef(false);
  // The mode as of now, for results that land later: set together with the mode, never a render behind it.
  const modeNow = useRef<Mode>('scroll');
  // Like failures that came while the call was still connecting: the agent says them once it is live, or the device
  // says them when the app is back to scrolling.
  const heldForAgent = useRef<string[]>([]);
  const [allowStrokeCue] = useState(() => createRateLimiter(STROKE_CUE_INTERVAL_MS));
  const [strokeCue, setStrokeCue] = useState(false);
  const strokeCueTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focused = useIsFocused();
  // True while the camera is open over the feed: the feed says nothing behind it.
  const covered = useRef(false);
  useLikeLedger();

  useEffect(() => () => clearTimeout(strokeCueTimer.current), []);

  const changeMode = (next: Mode) => {
    modeNow.current = next;
    setMode(next);
  };
  const takeHeld = () => heldForAgent.current.splice(0).join(' ');

  const onAgentExit = (reason: EndReason, message: string) => {
    if (covered.current) narrator.speak([message, takeHeld()].filter(Boolean).join(' '));
    else prefix.current = [message, takeHeld()].filter(Boolean).join(' ');
    changeMode('scroll');
    if (reason === 'signIn') router.push('/sign-in');
  };
  const agent = useVoiceAgent({ active: mode === 'agent', post, feed: { state, go }, narrator, onExit: onAgentExit });
  const wakeSetting = useSyncExternalStore(wakeOnOpen.subscribe, wakeOnOpen.get);
  const agentStatus = agent.status;

  useEffect(() => onDevWake(() => changeMode('agent')), []);

  useEffect(() => {
    if (agentStatus !== 'listening') return;
    const held = takeHeld();
    if (held && !agent.say(held)) heldForAgent.current.unshift(held);
  });

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
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string) => {
      if (!cancelled) setNarration(text);
    };
    const say = (text: string) => {
      if (cancelled) return;
      show(text);
      narrator.speak(`${prefix.current} ${text}`.trim());
      prefix.current = '';
    };
    const launch = launchWake.decide({ setting: wakeSetting, signedIn: !!account, onFeed: !thread, feedReady: !!post, awake: mode === 'agent' });
    if (mode === 'agent') narrator.stop();
    else if (launch === 'wait') return;
    else if (launch === 'wake') {
      // The launch wake goes the way a clockwise circle does, and the first post waits until the agent sleeps.
      queueMicrotask(() => {
        haptic('agentAwake');
        modeNow.current = 'agent';
        setMode('agent');
      });
    } else if (thread?.status === 'loading') loadingTimer = setTimeout(() => say(commentMessages.loading), LOADING_ANNOUNCE_MS);
    else if (thread) {
      const entry = entering.current ? commentsEntry(thread.replies.length) : null;
      entering.current = false;
      const current = thread.replies[thread.index];
      if (!current) say(commentsEntry(0));
      else {
        postNarrator.focus(current, { prefix: [prefix.current, entry].filter(Boolean).join(' '), reply: replyPosition(current, thread.index, thread.replies.length) });
        prefix.current = '';
      }
    } else if (!post) say(status ?? '');
    else {
      postNarrator.focus(post, { prefix: prefix.current });
      prefix.current = '';
    }
    return () => {
      cancelled = true;
      clearTimeout(loadingTimer);
      if (covered.current) return;
      postNarrator.stop();
      narrator.stop();
    };
  }, [mode, post, status, narrator, postNarrator, thread, focused, wakeSetting, account]);

  useEffect(() => postNarrator.onScript(setNarration), [postNarrator]);
  useEffect(() => postNarrator.prefetch(state.posts.slice(state.index + 1)), [postNarrator, state.posts, state.index]);

  // While the agent is awake the call owns the audio: the app's messages go through the agent's voice, never
  // on-device speech, and before the call is live a haptic is the only answer.
  const tellInAgentMode = (text: string) => {
    if (!agent.say(text)) haptic('edge');
  };
  const tell = (text: string) => (mode === 'agent' ? tellInAgentMode(text) : narrator.speak(text));
  // Confirms something done to the post or reply in focus without cutting it off: after its earcon and script.
  const confirm = (text: string) => (mode === 'agent' ? tellInAgentMode(text) : postNarrator.sayAfter(text));

  const step = (direction: 'next' | 'previous') => {
    const outcome = go(direction);
    if (outcome === 'moved') return haptic(direction);
    haptic('edge');
    if (!state.error) tell(outcome === 'atStart' ? messages.atStart : outcome === 'atEnd' ? messages.atEnd : outcome === 'unavailable' ? messages.noMore : messages.loading);
  };

  const stepReply = (direction: 'next' | 'previous') => {
    const outcome = comments.move(direction);
    if (outcome === 'moved') return haptic(direction);
    haptic('edge');
    if (thread?.status === 'ready' && !thread.replies.length) return narrator.speak(commentsEntry(0));
    narrator.speak(outcome === 'atStart' ? commentMessages.atStart : outcome === 'atEnd' ? commentMessages.atEnd : commentMessages.loading);
  };

  const page = (direction: 'next' | 'previous') => (thread ? stepReply(direction) : step(direction));

  const openComments = () => {
    if (!post) {
      haptic('edge');
      return narrator.speak(commentMessages.noPost);
    }
    haptic('commentsOpen');
    entering.current = true;
    comments.open(post.uri, () => {
      haptic('edge');
      entering.current = false;
      prefix.current = commentMessages.failed;
    });
  };

  const closeComments = () => {
    haptic('commentsClose');
    prefix.current = commentMessages.backToPosts;
    comments.close();
  };

  const switchMode = (next: Mode) => {
    if (next === mode) {
      haptic('edge');
      if (next === 'agent') agent.say(messages.alreadyAwake);
      else narrator.speak(messages.alreadyScrolling);
      return;
    }
    haptic(next === 'agent' ? 'agentAwake' : 'agentAsleep');
    if (next === 'scroll') prefix.current = [messages.agentAsleep, takeHeld()].filter(Boolean).join(' ');
    else comments.close();
    changeMode(next);
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

  const target = thread ? reply : post;
  const liked = target ? !!likeUriOf(target) : false;
  const focusedUri = useRef(target?.uri ?? null);
  useEffect(() => {
    focusedUri.current = target?.uri ?? null;
  });

  // A two-finger hold or the Like action. The haptic and sound say at once which way it went, over any narration; the
  // result belongs to the post it was made on. A success adds the word only if that post is still in focus and
  // nothing is being said. A failure is always said in full, naming the post: after what is being said, or before the
  // next post if the user moves on. While the agent is awake nothing is spoken on the device: a failure goes through
  // the agent's voice, and one that comes while the call is connecting waits for it.
  // A like that failed or isn't confirmed, or an undo that failed once Bluesky answered: its own haptic, then said in
  // full on the device, through the agent's voice, or held while the call connects.
  const reportProblem = (message: string) => {
    haptic('likeFailed');
    if (modeNow.current === 'scroll') return postNarrator.notice(message);
    if (!agent.say(message)) heldForAgent.current.push(message);
  };
  const report = useRef(reportProblem);
  useEffect(() => {
    report.current = reportProblem;
  });
  useEffect(() => actionHistory.onTell((text) => report.current(text)), []);

  const like = async () => {
    if (!target) {
      haptic('edge');
      return tell(thread ? (thread.status === 'loading' ? commentMessages.loading : commentsEntry(0)) : (status ?? commentMessages.noPost));
    }
    if (!account) {
      haptic('edge');
      return tell(commentMessages.signInToLike);
    }
    if (likeInFlight(target)) return haptic('edge');
    const liking = !likeUriOf(target);
    haptic(liking ? 'like' : 'unlike');
    earcons.play(liking ? 'like' : 'unlike');
    const result = await toggleLike(provider, target, actionHistory);
    if (result.outcome === 'failed') return reportProblem(likeFailure(whose(target), result.wasLiked, result.reason));
    if (result.outcome === 'unconfirmed') return reportProblem(likeUnconfirmed(whose(target), result.wasLiked));
    if (result.outcome !== 'liked' && result.outcome !== 'unliked') return;
    if (modeNow.current === 'agent' || focusedUri.current !== target.uri || postNarrator.speaking()) return;
    narrator.speak(result.outcome === 'liked' ? commentMessages.liked : commentMessages.unliked);
  };

  useEffect(() =>
    registerCommentsController({
      open: () => {
        if (!post || mode !== 'scroll') return false;
        if (!thread) openComments();
        return true;
      },
      close: () => {
        if (!thread) return false;
        closeComments();
        return true;
      },
      read: async (postUri) => {
        return replyScripts(await comments.read(postUri));
      },
      loaded: (postUri) => {
        const loaded = comments.state.threads[postUri];
        return loaded?.status === 'ready' ? replyScripts(loaded.replies) : null;
      },
    }),
  );

  const onSwipe = (direction: SwipeDirection) => {
    if (mode === 'agent') return haptic('edge');
    switch (direction) {
      case 'left':
        return page('previous');
      case 'right':
        return page('next');
      case 'up':
        if (!thread) return openComments();
        haptic('edge');
        return confirm(commentMessages.alreadyOpen);
      case 'down':
        if (thread) return closeComments();
        haptic('camera');
        return void openCamera();
    }
  };

  const onTapTop = () => (mode === 'scroll' ? page('previous') : tellInAgentMode(messages.gestures));
  const onTapBottom = () => (mode === 'scroll' ? page('next') : onAgentExit('signIn', 'Opening the sign-in screen.'));
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
        return page('next');
      case 'previous':
      case 'decrement':
        return page('previous');
      case 'like':
        return like();
      case 'comments':
        return openComments();
      case 'back':
        return closeComments();
      case 'reread':
        return mode === 'scroll' ? narrator.speak(narration) : tellInAgentMode(narration);
      case 'readExactly':
        if (post && mode === 'scroll') postNarrator.focus(post, { mode: 'verbatim' });
        return;
      case 'toggleAgent':
        return switchMode(mode === 'scroll' ? 'agent' : 'scroll');
      case 'instructions':
        return tell(messages.gestures);
      case 'account':
        return mode === 'scroll' ? router.push('/sign-in') : onTapBottom();
      case 'camera':
        return void openCamera();
    }
    if (isNarrationAction(nativeEvent.actionName)) {
      const message = applyNarrationAction(nativeEvent.actionName, screenReader);
      if (mode !== 'scroll') return tellInAgentMode(message);
      if (thread && reply) return postNarrator.focus(reply, { prefix: message, reply: replyPosition(reply, thread.index, thread.replies.length) });
      if (post && !thread) return postNarrator.focus(post, { prefix: message });
      narrator.speak(message);
    }
  };

  const scrolling = mode === 'scroll';
  const view = !scrolling ? 'agent' : thread ? 'comments' : 'feed';
  const likedMark = liked ? ' · Liked' : '';
  return (
    <SafeAreaView style={styles.screen}>
      <GestureSurface
        style={styles.surface}
        discoveryMode={mode}
        tapsEnabled
        onTapTop={onTapTop}
        onTapBottom={onTapBottom}
        onCircle={onCircle}
        onSwipe={onSwipe}
        onTwoFingerHold={like}
        onTwoFingerHoldWarning={() => haptic('holdWarning')}
        onUnrecognizedStroke={onUnrecognizedStroke}
        accessible
        accessibilityRole={Platform.OS === 'ios' ? DIRECT_TOUCH : 'adjustable'}
        accessibilityLabel={view === 'feed' ? 'Feed' : view === 'comments' ? 'Replies' : `Voice agent, ${AGENT_STATUS[agentStatus ?? 'starting'].toLowerCase()}`}
        accessibilityHint={
          view === 'feed'
            ? 'Tap the bottom half or swipe right for the next post, the top half or swipe left for the previous post. Swipe up for replies. Hold two fingers on the screen to like. Draw a clockwise circle to wake the agent.'
            : view === 'comments'
              ? 'Tap the bottom half or swipe right for the next reply, the top half or swipe left for the previous reply. Hold two fingers on the screen to like. Swipe down to go back to posts.'
              : 'Tap the top half to hear the instructions, the bottom half for account settings. Hold two fingers on the screen to like the post. Draw a counter-clockwise circle to go back to scrolling.'
        }
        accessibilityValue={{ text: narration }}
        accessibilityActions={[...surfaceActions(view, Platform.OS, liked), ...(scrolling ? narrationActions(narrationPrefs, screenReader) : [])]}
        onAccessibilityTap={onTapBottom}
        onAccessibilityAction={onAccessibilityAction}
        onMagicTap={() => switchMode(scrolling ? 'agent' : 'scroll')}
        onAccessibilityEscape={() => (view === 'comments' ? closeComments() : switchMode('scroll'))}>
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {view === 'feed' ? '▲ Previous post' : view === 'comments' ? '▲ Previous reply' : '▲ Hear the instructions'}
        </Text>
        {!scrolling ? (
          <View style={styles.agentBar}>
            <Text style={[styles.agentTitle, { color: colors.agent }]} maxFontSizeMultiplier={type.maxScale}>
              Agent: {AGENT_STATUS[agentStatus ?? 'starting']}
            </Text>
          </View>
        ) : null}
        {view === 'comments' ? (
          reply && post ? (
            <PostCard
              post={reply}
              context={`Replying to ${reply.parentAuthor ? (reply.parentAuthor.displayName ?? reply.parentAuthor.handle) : authorName(post)}`}
              position={`Reply ${(thread?.index ?? 0) + 1} of ${thread?.replies.length ?? 0}${likedMark}`}
            />
          ) : (
            <View style={styles.panel}>
              <Text style={styles.statusText}>{thread?.status === 'loading' ? commentMessages.loading : commentsEntry(0)}</Text>
            </View>
          )
        ) : post ? (
          <PostCard post={post} position={`${state.index + 1} of ${state.posts.length}${state.exhausted ? '' : '+'}${likedMark}`} />
        ) : (
          <View style={styles.panel}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {strokeCue ? messages.unrecognized : view === 'feed' ? '▼ Next post · ▲ swipe up for replies' : view === 'comments' ? '▼ Next reply · swipe down for posts' : '▼ Account settings'}
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
