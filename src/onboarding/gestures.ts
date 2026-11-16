import type { HapticEvent } from '@/feedback/haptics';
import type { CircleDirection } from '@/gestures/circle';

import type { StrokeKind } from './strokes';

export type PracticedGestureId = 'tapTop' | 'tapBottom' | 'circleClockwise' | 'circleCounterclockwise';
export type GestureId = PracticedGestureId | 'swipeLeft' | 'swipeRight' | 'swipeUp' | 'swipeDown' | 'swipeDownCamera' | 'twoFingerHold';
// The feed in focus: posts, a post's replies, or the agent.
export type FeedMode = 'scroll' | 'comments' | 'agent';
export type Cue = StrokeKind | 'idle';

// launch: taught on first launch. tip: introduced later in one sentence, the first time it is useful.
export type Gesture = {
  id: GestureId;
  stage: 'launch' | 'tip';
  title: string;
  action: string;
  hint: string;
  intro?: string;
  signedInOnly?: boolean;
  modes: FeedMode[];
  cues: Cue[];
};

export type TaughtGesture = Gesture & {
  id: PracticedGestureId;
  kind: 'tap' | 'stroke';
  name: string;
  instruction: string;
  retry: string;
  tip: string;
  haptic: HapticEvent;
  symbol: string;
  half?: 'top' | 'bottom';
};

const TAP_TIP = 'Tip: the screen is split across the middle. Use one finger and lift it quickly.';
const CIRCLE_TIP =
  'Tip: start near the middle and keep a steady pace. With VoiceOver, a two-finger double tap also wakes and sleeps the agent.';

export const GESTURES: TaughtGesture[] = [
  {
    id: 'tapTop',
    stage: 'launch',
    kind: 'tap',
    title: 'Tap the top half',
    name: 'a tap on the top half',
    action: 'go to the previous post',
    instruction: 'Tap once anywhere on the top half of the screen, then lift your finger.',
    retry: 'Tap higher up, above the middle of the screen, and lift your finger straight away.',
    tip: TAP_TIP,
    hint: 'To go back to the previous post, tap the top half of the screen.',
    haptic: 'previous',
    symbol: '▲',
    half: 'top',
    modes: ['scroll', 'comments'],
    cues: [],
  },
  {
    id: 'tapBottom',
    stage: 'launch',
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
    modes: ['scroll', 'comments'],
    cues: ['idle'],
  },
  {
    id: 'circleClockwise',
    stage: 'launch',
    kind: 'stroke',
    title: 'Draw a circle clockwise',
    name: 'a clockwise circle',
    action: 'wake the agent after it sleeps',
    instruction:
      "Draw a big circle clockwise, the way a clock's hands move, anywhere on the screen. Keep your finger down until you have gone all the way round, then lift.",
    retry: 'Go clockwise: across the top from left to right, then down and round. Make it about the size of your palm, and go all the way round before you lift.',
    tip: CIRCLE_TIP,
    hint: 'To wake the voice agent after it sleeps, draw a big circle clockwise anywhere on the screen.',
    haptic: 'agentAwake',
    symbol: '↻',
    modes: ['scroll', 'comments'],
    cues: ['curve'],
  },
  {
    id: 'circleCounterclockwise',
    stage: 'launch',
    kind: 'stroke',
    title: 'Draw a circle counter-clockwise',
    name: 'a counter-clockwise circle',
    action: 'put it back to sleep',
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

// Gestures the feed knows beyond the four practiced on first launch. Swiping left and right is named once on first
// launch; the rest are introduced just in time (see tips.ts).
export const EXTRA_GESTURES: Gesture[] = [
  {
    id: 'swipeLeft',
    stage: 'launch',
    title: 'Swipe left',
    action: 'go back to the previous post',
    hint: 'To go back to the previous post, swipe left in a quick straight line.',
    modes: ['scroll', 'comments'],
    cues: ['swipeLeft'],
  },
  {
    id: 'swipeRight',
    stage: 'launch',
    title: 'Swipe right',
    action: 'move on to the next post',
    hint: 'To hear the next post, swipe right in a quick straight line.',
    modes: ['scroll', 'comments'],
    cues: ['swipeRight'],
  },
  {
    id: 'swipeUp',
    stage: 'tip',
    title: 'Swipe up',
    action: 'hear the replies to a post',
    hint: 'To hear the replies to a post, swipe up in a quick straight line.',
    intro: 'Tip: swipe up to hear the replies to a post.',
    modes: ['scroll'],
    cues: ['swipeUp'],
  },
  {
    id: 'swipeDown',
    stage: 'tip',
    title: 'Swipe down',
    action: 'go back from the replies to the posts',
    hint: 'To go back to the posts, swipe down in a quick straight line.',
    intro: 'Tip: swipe down to go back to the posts.',
    modes: ['comments'],
    cues: ['swipeDown'],
  },
  {
    id: 'swipeDownCamera',
    stage: 'tip',
    title: 'Swipe down on a post',
    action: 'open the camera',
    hint: 'To open the camera, swipe down on a post in a quick straight line.',
    intro: 'Tip: swipe down on a post to open the camera.',
    modes: ['scroll'],
    cues: ['swipeDown'],
  },
  {
    id: 'twoFingerHold',
    stage: 'tip',
    title: 'Hold two fingers on the screen, through the buzz until the like sound,',
    action: 'like a post, or remove your like',
    hint: 'To like a post, hold two fingers on the screen through the buzz until you hear the like sound.',
    intro: 'Tip: to like a post, hold two fingers until the like sound.',
    signedInOnly: true,
    modes: ['scroll', 'comments'],
    cues: [],
  },
];

export const ALL_GESTURES: Gesture[] = [...GESTURES, ...EXTRA_GESTURES];

export const introducedGestures = (introduced: GestureId[], signedIn: boolean): Gesture[] =>
  ALL_GESTURES.filter((gesture) => (gesture.stage === 'launch' || introduced.includes(gesture.id)) && (signedIn || !gesture.signedInOnly));

export const circleGesture = (direction: CircleDirection): GestureId =>
  direction === 'clockwise' ? 'circleClockwise' : 'circleCounterclockwise';

export const gestureSummary = (gestures: Gesture[] = GESTURES) => gestures.map((gesture) => `${gesture.title} to ${gesture.action}.`).join(' ');

// Names only what has been introduced, then how many more there are to come.
export function gestureHelp(gestures: Gesture[] = GESTURES, signedIn = true): string {
  const more = ALL_GESTURES.filter((gesture) => !gestures.includes(gesture) && (signedIn || !gesture.signedInOnly)).length;
  const coming = more === 0 ? '' : more === 1 ? ' One more gesture is introduced as you go.' : ` ${more} more gestures are introduced as you go.`;
  return `Gesture help. ${gestureSummary(gestures)}${coming} You can practice the main ones again from account settings.`;
}
