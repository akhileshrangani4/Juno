import type { HapticEvent } from '@/feedback/haptics';
import type { CircleDirection } from '@/gestures/circle';

import type { StrokeKind } from './strokes';

export type GestureId = 'tapTop' | 'tapBottom' | 'circleClockwise' | 'circleCounterclockwise';
export type FeedMode = 'scroll' | 'agent';
export type Cue = StrokeKind | 'idle';

export type TaughtGesture = {
  id: GestureId;
  kind: 'tap' | 'stroke';
  title: string;
  name: string;
  action: string;
  instruction: string;
  retry: string;
  tip: string;
  hint: string;
  haptic: HapticEvent;
  symbol: string;
  half?: 'top' | 'bottom';
  modes: FeedMode[];
  cues: Cue[];
};

const TAP_TIP = 'Tip: the screen is split across the middle. Use one finger and lift it quickly.';
const CIRCLE_TIP =
  'Tip: start near the middle and keep a steady pace. With VoiceOver, a two-finger double tap also wakes and sleeps the agent.';

export const GESTURES: TaughtGesture[] = [
  {
    id: 'tapTop',
    kind: 'tap',
    title: 'Tap the top half',
    name: 'a tap on the top half',
    action: 'go back to the previous post',
    instruction: 'Tap once anywhere on the top half of the screen, then lift your finger.',
    retry: 'Tap higher up, above the middle of the screen, and lift your finger straight away.',
    tip: TAP_TIP,
    hint: 'To go back to the previous post, tap the top half of the screen.',
    haptic: 'previous',
    symbol: '▲',
    half: 'top',
    modes: ['scroll'],
    cues: ['swipeDown', 'swipeRight'],
  },
  {
    id: 'tapBottom',
    kind: 'tap',
    title: 'Tap the bottom half',
    name: 'a tap on the bottom half',
    action: 'move on to the next post',
    instruction: 'Tap once anywhere on the bottom half of the screen, then lift your finger.',
    retry: 'Tap lower down, below the middle of the screen, and lift your finger straight away.',
    tip: TAP_TIP,
    hint: 'To hear the next post, tap the bottom half of the screen.',
    haptic: 'next',
    symbol: '▼',
    half: 'bottom',
    modes: ['scroll'],
    cues: ['idle', 'swipeUp', 'swipeLeft'],
  },
  {
    id: 'circleClockwise',
    kind: 'stroke',
    title: 'Draw a circle clockwise',
    name: 'a clockwise circle',
    action: 'wake the voice agent',
    instruction:
      "Draw a big circle clockwise, the way a clock's hands move, anywhere on the screen. Keep your finger down until you have gone all the way round, then lift.",
    retry: 'Go clockwise: across the top from left to right, then down and round. Make it about the size of your palm, and go all the way round before you lift.',
    tip: CIRCLE_TIP,
    hint: 'To wake the voice agent, draw a big circle clockwise anywhere on the screen.',
    haptic: 'agentAwake',
    symbol: '↻',
    modes: ['scroll'],
    cues: ['curve'],
  },
  {
    id: 'circleCounterclockwise',
    kind: 'stroke',
    title: 'Draw a circle counter-clockwise',
    name: 'a counter-clockwise circle',
    action: 'put the agent back to sleep',
    instruction: 'Draw a big circle counter-clockwise, the other way round: across the top from right to left, then down and round.',
    retry: 'Go counter-clockwise: across the top from right to left, then down and round. Make it about the size of your palm, and go all the way round before you lift.',
    tip: CIRCLE_TIP,
    hint: 'To put the agent to sleep and go back to scrolling, draw a big circle counter-clockwise.',
    haptic: 'agentAsleep',
    symbol: '↺',
    modes: ['agent'],
    cues: ['curve'],
  },
];

export const circleGesture = (direction: CircleDirection): GestureId =>
  direction === 'clockwise' ? 'circleClockwise' : 'circleCounterclockwise';

export const gestureSummary = (gestures: TaughtGesture[] = GESTURES) =>
  gestures.map((gesture) => `${gesture.title} to ${gesture.action}.`).join(' ');

export const gestureHelp = (gestures: TaughtGesture[] = GESTURES) =>
  `Gesture help. ${gestureSummary(gestures)} You can practice them again from account settings.`;
