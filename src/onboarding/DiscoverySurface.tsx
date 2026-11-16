import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react';

import { GestureSurface } from '@/gestures/GestureSurface';
import type { SwipeDirection } from '@/gestures/swipe';
import { postNarratorFor } from '@/narration/postNarration';
import { useNarrator } from '@/narration/useNarrator';

import { discoveryReducer, startDiscovery, type DiscoveryEvent, type DiscoveryState } from './discovery';
import { ALL_GESTURES, circleGesture, gestureHelp, introducedGestures, type FeedMode, type GestureId } from './gestures';
import { loadDiscoveryProgress, saveDiscoveryProgress } from './progressStore';
import { classifyStroke } from './strokes';
import { offerTip, releaseTip, startTips, tipMessages, tipsAgain, tipsOff, type TipState } from './tips';

const TICK_MS = 5_000;

const SWIPES: Record<SwipeDirection, GestureId> = { left: 'swipeLeft', right: 'swipeRight', up: 'swipeUp', down: 'swipeDown' };

type Props = ComponentProps<typeof GestureSurface> & {
  discoveryMode: FeedMode;
  signedIn?: boolean;
  // Gestures worth a just-in-time tip right now, most useful first (see tips.ts).
  tipCandidates?: GestureId[];
  // Changes when the user moves to another post or view, so a tip dropped for want of a gap is offered again there.
  tipKey?: string;
};

export function DiscoverySurface({
  discoveryMode,
  signedIn = false,
  tipCandidates = [],
  tipKey = '',
  onTapTop,
  onTapBottom,
  onCircle,
  onSwipe,
  onTwoFingerHold,
  onTwoFingerHoldWarning,
  onTalkHold,
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
  const discovery = useRef<{ sessions: number; state: DiscoveryState; tips: TipState } | null>(null);
  const [shown, setShown] = useState<{ version: number; off: boolean; anyIntroduced: boolean } | null>(null);
  const show = (tips: TipState) =>
    setShown((last) => ({ version: (last?.version ?? 0) + 1, off: tips.tipsOff, anyIntroduced: tips.introduced.length > 0 }));

  const known = () => introducedGestures(discovery.current?.tips.introduced ?? [], signedIn);

  const save = () => {
    const current = discovery.current;
    if (!current) return;
    const { introduced, tipsOff: off, lastTipSession } = current.tips;
    saveDiscoveryProgress({ sessions: current.sessions, learned: current.state.learned, introduced, tipsOff: off, lastTipSession });
  };

  const dispatch = (event: DiscoveryEvent): boolean => {
    const current = discovery.current;
    if (!current) return false;
    const { state, hint } = discoveryReducer(current.state, event, known());
    discovery.current = { ...current, state };
    if (state.learned !== current.state.learned) save();
    if (hint) narrator.speak(hint.hint);
    return hint !== null;
  };

  const updateTips = (tips: TipState) => {
    const current = discovery.current;
    if (!current || tips === current.tips) return;
    discovery.current = { ...current, tips };
    save();
    show(tips);
  };

  const release = () => {
    const current = discovery.current;
    if (!current) return;
    const { state, tip } = releaseTip(current.tips, { at: Date.now(), mode: discoveryMode, narrating: postNarrator.speaking() });
    if (state === current.tips) return;
    discovery.current = { ...current, tips: state };
    if (tip?.intro) narrator.speak(tip.intro);
    if (tip) {
      save();
      show(state);
    }
  };
  const onEffectEvent = useEffectEvent(dispatch);

  useEffect(() => {
    let cancelled = false;
    loadDiscoveryProgress().then((saved) => {
      if (cancelled) return;
      const sessions = saved.sessions + 1;
      discovery.current = {
        sessions,
        state: startDiscovery(saved, introducedGestures(saved.introduced, signedIn)),
        tips: startTips(saved, sessions),
      };
      save();
      show(discovery.current.tips);
    });
    return () => {
      cancelled = true;
    };
    // Progress loads once per mount; signedIn only filters what is named later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQuiet = useEffectEvent(() => {
    dispatch({ type: 'quiet', mode: discoveryMode, at: Date.now() });
  });
  useEffect(() => narrator.onDone(() => onQuiet()), [narrator]);

  // Tips are released on the tick, never straight from a done callback, so they can't land on speech another listener
  // starts in the same moment.
  const onTick = useEffectEvent(() => {
    if (!dispatch({ type: 'tick', mode: discoveryMode, narrating: postNarrator.speaking(), at: Date.now() })) release();
  });

  useEffect(() => {
    if (discoveryMode !== 'agent') onEffectEvent({ type: 'scrolling', at: Date.now() });
  }, [discoveryMode]);

  useEffect(() => {
    if (!focused) return;
    onEffectEvent({ type: 'quiet', mode: discoveryMode, at: Date.now() });
    const timer = setInterval(() => onTick(), TICK_MS);
    return () => clearInterval(timer);
  }, [focused, discoveryMode, postNarrator]);

  const offer = useEffectEvent(() => {
    const current = discovery.current;
    const allowed = tipCandidates.filter((id) => signedIn || !ALL_GESTURES.some((gesture) => gesture.id === id && gesture.signedInOnly));
    if (current && discoveryMode !== 'agent') updateTips(offerTip(current.tips, allowed, Date.now()));
  });
  const candidateKey = tipCandidates.join(',');
  const version = shown?.version ?? 0;
  useEffect(() => offer(), [candidateKey, tipKey, discoveryMode, version]);

  const recognized = (gesture: GestureId) => {
    dispatch({ type: 'recognized', gesture, at: Date.now() });
    const current = discovery.current;
    const isTip = ALL_GESTURES.some((known) => known.id === gesture && known.stage === 'tip');
    if (current && isTip && !current.tips.introduced.includes(gesture)) {
      const pending = current.tips.pending?.id === gesture ? null : current.tips.pending;
      updateTips({ ...current.tips, introduced: [...current.tips.introduced, gesture], pending });
    }
  };
  const activity = () => dispatch({ type: 'activity', at: Date.now() });

  const tipActions = !shown
    ? []
    : shown.off
      ? [{ name: 'tipsAgain', label: 'Tell me the tips again' }]
      : [{ name: 'noMoreTips', label: 'No more tips' }, ...(shown.anyIntroduced ? [{ name: 'tipsAgain', label: 'Tell me the tips again' }] : [])];

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
      onSwipe={
        onSwipe &&
        ((direction) => {
          recognized(SWIPES[direction]);
          onSwipe(direction);
        })
      }
      onTwoFingerHold={
        onTwoFingerHold &&
        (() => {
          recognized('twoFingerHold');
          onTwoFingerHold();
        })
      }
      onTwoFingerHoldWarning={
        onTwoFingerHoldWarning &&
        (() => {
          activity();
          onTwoFingerHoldWarning();
        })
      }
      onTalkHold={
        onTalkHold && {
          start: () => {
            activity();
            onTalkHold.start();
          },
          end: (cancelled) => onTalkHold.end(cancelled),
        }
      }
      onUnrecognizedStroke={(points) => {
        const hinted = dispatch({ type: 'unrecognized', stroke: classifyStroke(points), mode: discoveryMode, narrating: postNarrator.speaking(), at: Date.now() });
        if (!hinted) onUnrecognizedStroke?.(points);
      }}
      accessibilityActions={
        discoveryMode !== 'agent' ? [...(accessibilityActions ?? []), ...tipActions, { name: 'gestureHelp', label: 'Gesture help' }] : accessibilityActions
      }
      onAccessibilityAction={(event) => {
        activity();
        const name = event.nativeEvent.actionName;
        const current = discovery.current;
        if (discoveryMode !== 'agent' && name === 'gestureHelp') return narrator.speak(gestureHelp(known(), signedIn));
        if (discoveryMode !== 'agent' && current && (name === 'noMoreTips' || name === 'tipsAgain')) {
          updateTips(name === 'noMoreTips' ? tipsOff(current.tips) : tipsAgain(current.tips));
          return narrator.speak(name === 'noMoreTips' ? tipMessages.off : tipMessages.again);
        }
        onAccessibilityAction?.(event);
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
