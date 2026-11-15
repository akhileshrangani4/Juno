import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCachedDescription } from '@/backend/convex';
import { haptic } from '@/feedback/haptics';
import { useFeed } from '@/feed/useFeed';
import type { CircleDirection } from '@/gestures/circle';
import { GestureSurface } from '@/gestures/GestureSurface';
import { buildPostNarration, messages } from '@/narration/buildNarration';
import { useNarrator } from '@/narration/useNarrator';
import { useSession } from '@/session/SessionContext';
import { colors, type } from '@/theme';

import { PostCard } from './PostCard';

type Mode = 'scroll' | 'agent';

const DIRECT_TOUCH = 'allowsDirectInteraction' as unknown as AccessibilityRole;

export function MainScreen() {
  const { provider } = useSession();
  const narrator = useNarrator();
  const { state, post, go } = useFeed(provider);
  const [mode, setMode] = useState<Mode>('scroll');
  const prefix = useRef('');

  const status = post ? null : state.error ? messages.feedError : state.exhausted ? messages.empty : messages.loadingFirst;

  useEffect(() => {
    let cancelled = false;
    const say = (text: string) => {
      if (cancelled) return;
      narrator.speak(`${prefix.current} ${text}`.trim());
      prefix.current = '';
    };
    if (mode === 'agent') say(messages.agentAwake);
    else if (!post) say(status ?? '');
    else if (post.media.some((media) => (media.kind === 'images' && media.images.some((image) => !image.alt)) || (media.kind === 'video' && !media.alt))) {
      fetchCachedDescription(post.uri).then((description) => say(buildPostNarration(post, new Date(), description)));
    } else say(buildPostNarration(post, new Date()));
    return () => {
      cancelled = true;
      narrator.stop();
    };
  }, [mode, post, status, narrator]);

  const step = (direction: 'next' | 'previous') => {
    const outcome = go(direction);
    if (outcome === 'moved') return haptic(direction);
    haptic('edge');
    if (!state.error) narrator.speak(outcome === 'atStart' ? messages.atStart : outcome === 'atEnd' ? messages.atEnd : messages.loading);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) {
      haptic('edge');
      narrator.speak(next === 'agent' ? messages.alreadyAwake : messages.alreadyScrolling);
      return;
    }
    haptic(next === 'agent' ? 'agentAwake' : 'agentAsleep');
    if (next === 'scroll') prefix.current = messages.agentAsleep;
    setMode(next);
  };

  const onTapTop = () => (mode === 'scroll' ? step('previous') : narrator.speak(messages.gestures));
  const onTapBottom = () => (mode === 'scroll' ? step('next') : router.push('/sign-in'));
  const onCircle = (direction: CircleDirection) => switchMode(direction === 'clockwise' ? 'agent' : 'scroll');

  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    switch (nativeEvent.actionName) {
      case 'activate':
      case 'increment':
      case 'bottom':
        return onTapBottom();
      case 'decrement':
      case 'top':
        return onTapTop();
      case 'magicTap':
      case 'toggleAgent':
        return switchMode(mode === 'scroll' ? 'agent' : 'scroll');
      case 'escape':
        return switchMode('scroll');
    }
  };

  const scrolling = mode === 'scroll';
  return (
    <SafeAreaView style={styles.screen}>
      <GestureSurface
        style={styles.surface}
        tapsEnabled
        onTapTop={onTapTop}
        onTapBottom={onTapBottom}
        onCircle={onCircle}
        accessible
        accessibilityRole={Platform.OS === 'ios' ? DIRECT_TOUCH : 'adjustable'}
        accessibilityLabel={scrolling ? 'Feed' : 'Voice agent'}
        accessibilityHint={
          scrolling
            ? 'Tap the bottom half for the next post, the top half for the previous post. Draw a clockwise circle to wake the agent.'
            : 'Tap the top half to hear the instructions, the bottom half for account settings. Draw a counter-clockwise circle to go back to scrolling.'
        }
        accessibilityActions={[
          { name: 'activate', label: scrolling ? 'Next post' : 'Account settings' },
          { name: 'increment' },
          { name: 'decrement' },
          { name: 'bottom', label: scrolling ? 'Next post' : 'Account settings' },
          { name: 'top', label: scrolling ? 'Previous post' : 'Hear the instructions' },
          { name: 'toggleAgent', label: scrolling ? 'Wake the agent' : 'Back to scrolling' },
          { name: 'magicTap' },
          { name: 'escape' },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        onMagicTap={() => switchMode(scrolling ? 'agent' : 'scroll')}
        onAccessibilityEscape={() => switchMode('scroll')}>
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {scrolling ? '▲ Previous post' : '▲ Hear the instructions'}
        </Text>
        {!scrolling ? (
          <View style={[styles.panel, styles.agent]}>
            <Text style={[styles.title, { color: colors.agent }]}>Agent is awake</Text>
            <Text style={styles.statusText}>The voice agent is not connected yet. Draw a counter-clockwise circle to go back to scrolling.</Text>
          </View>
        ) : post ? (
          <PostCard post={post} position={`${state.index + 1} of ${state.posts.length}${state.exhausted ? '' : '+'}`} />
        ) : (
          <View style={styles.panel}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}
        <Text style={styles.hint} maxFontSizeMultiplier={type.maxScale}>
          {scrolling ? '▼ Next post' : '▼ Account settings'}
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
  agent: { borderColor: colors.agent },
  title: { fontSize: 36, fontWeight: '800' },
  statusText: { color: colors.text, fontSize: type.body, lineHeight: type.bodyLineHeight, fontWeight: '600' },
});
