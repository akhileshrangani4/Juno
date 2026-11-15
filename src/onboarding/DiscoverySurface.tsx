import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useRef, type ComponentProps } from 'react';

import { GestureSurface } from '@/gestures/GestureSurface';
import { postNarratorFor } from '@/narration/postNarration';
import { useNarrator } from '@/narration/useNarrator';

import { discoveryReducer, startDiscovery, type DiscoveryEvent, type DiscoveryState } from './discovery';
import { circleGesture, gestureHelp, type FeedMode, type GestureId } from './gestures';
import { loadDiscoveryProgress, saveDiscoveryProgress } from './progressStore';
import { classifyStroke } from './strokes';

const TICK_MS = 5_000;

type Props = ComponentProps<typeof GestureSurface> & { discoveryMode: FeedMode };

export function DiscoverySurface({
  discoveryMode,
  onTapTop,
  onTapBottom,
  onCircle,
  onUnrecognizedStroke,
  accessibilityActions,
  onAccessibilityAction,
  onMagicTap,
  onAccessibilityEscape,
  onAccessibilityTap,
  ...props
}: Props) {
  const narrator = useNarrator();
  const postNarrator = postNarratorFor(narrator);
  const focused = useIsFocused();
  const discovery = useRef<{ sessions: number; state: DiscoveryState } | null>(null);

  const dispatch = (event: DiscoveryEvent): boolean => {
    const current = discovery.current;
    if (!current) return false;
    const { state, hint } = discoveryReducer(current.state, event);
    discovery.current = { ...current, state };
    if (state.learned !== current.state.learned) saveDiscoveryProgress({ sessions: current.sessions, learned: state.learned });
    if (hint) narrator.speak(hint.hint);
    return hint !== null;
  };
  const onEffectEvent = useEffectEvent(dispatch);

  useEffect(() => {
    let cancelled = false;
    loadDiscoveryProgress().then((saved) => {
      if (cancelled) return;
      const progress = { ...saved, sessions: saved.sessions + 1 };
      saveDiscoveryProgress(progress);
      discovery.current = { sessions: progress.sessions, state: startDiscovery(progress) };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onQuiet = useEffectEvent(() => dispatch({ type: 'quiet', mode: discoveryMode, at: Date.now() }));
  useEffect(() => narrator.onDone(() => onQuiet()), [narrator]);

  useEffect(() => {
    if (discoveryMode === 'scroll') onEffectEvent({ type: 'scrolling', at: Date.now() });
  }, [discoveryMode]);

  useEffect(() => {
    if (!focused) return;
    onEffectEvent({ type: 'quiet', mode: discoveryMode, at: Date.now() });
    const timer = setInterval(() => onEffectEvent({ type: 'tick', mode: discoveryMode, narrating: postNarrator.speaking(), at: Date.now() }), TICK_MS);
    return () => clearInterval(timer);
  }, [focused, discoveryMode, postNarrator]);

  const recognized = (gesture: GestureId) => dispatch({ type: 'recognized', gesture, at: Date.now() });
  const activity = () => dispatch({ type: 'activity', at: Date.now() });

  return (
    <GestureSurface
      {...props}
      onTapTop={() => {
        recognized('tapTop');
        onTapTop();
      }}
      onTapBottom={() => {
        recognized('tapBottom');
        onTapBottom();
      }}
      onCircle={(direction) => {
        recognized(circleGesture(direction));
        onCircle(direction);
      }}
      onUnrecognizedStroke={(points) => {
        const hinted = dispatch({ type: 'unrecognized', stroke: classifyStroke(points), mode: discoveryMode, narrating: postNarrator.speaking(), at: Date.now() });
        if (!hinted) onUnrecognizedStroke?.(points);
      }}
      accessibilityActions={discoveryMode === 'scroll' ? [...(accessibilityActions ?? []), { name: 'gestureHelp', label: 'Gesture help' }] : accessibilityActions}
      onAccessibilityAction={(event) => {
        activity();
        if (event.nativeEvent.actionName === 'gestureHelp' && discoveryMode === 'scroll') narrator.speak(gestureHelp());
        else onAccessibilityAction?.(event);
      }}
      onMagicTap={
        onMagicTap &&
        (() => {
          activity();
          onMagicTap();
        })
      }
      onAccessibilityTap={
        onAccessibilityTap &&
        (() => {
          activity();
          onAccessibilityTap();
        })
      }
      onAccessibilityEscape={
        onAccessibilityEscape &&
        (() => {
          activity();
          onAccessibilityEscape();
        })
      }
    />
  );
}
