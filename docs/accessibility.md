# Accessibility decisions

The app is built for people who cannot see the screen. Most of them run VoiceOver (iOS) or TalkBack (Android), and both screen readers intercept touches: a single tap moves the screen reader cursor instead of reaching the app, and a one-finger drag is read as "explore by touch". Left alone, the half-screen taps and the circle gesture would never fire for the people the app is for.

The app is iOS first: VoiceOver is the supported screen reader for now. The code stays cross-platform and the TalkBack handling below is in place, but TalkBack is unverified.

Nothing in this document has been tried with VoiceOver or TalkBack on a physical phone yet. Simulators and cloud phones cannot run them properly. The checklist at the end is what to try on a real device.

## The main screen is one accessibility element

The feed and the agent screen are a single element (`GestureSurface` in `src/gestures`, configured in `src/screens/MainScreen.tsx`). The post text inside it is not exposed as separate elements, because the app narrates the post itself and a second set of focus stops would only get in the way.

### iOS: direct touch

On iOS the element carries the `UIAccessibilityTraitAllowsDirectInteraction` trait. React Native has no typed prop for it, but its native role parser accepts the string `allowsDirectInteraction` (see `accessibilityPropsConversions.h` in React Native 0.88), so the screen passes it as `accessibilityRole` with a cast. While VoiceOver focus is on a direct-touch element, touches inside it go straight to the app, so taps and circles behave exactly as they do with VoiceOver off. This is the same mechanism piano and drawing apps use.

The element covers the whole screen and is the only element, so focus lands on it when the screen opens. VoiceOver reads its label and hint once, which explains the gestures.

Users can turn direct touch off per app in the VoiceOver rotor. For them, and as a general fallback, the element also answers:

| Screen reader action | Scroll mode | Agent mode |
| --- | --- | --- |
| Double tap (activate) | Next post | Account settings |
| Swipe up / down (increment / decrement) | Next / previous post | Account settings / hear instructions |
| Custom actions in the rotor or TalkBack menu | Next post, Previous post, Wake the agent | Account settings, Hear the instructions, Back to scrolling |
| Two-finger double tap (magic tap, iOS) | Wake the agent | Back to scrolling |
| Two-finger scrub (escape, iOS) | - | Back to scrolling |

### Android (unverified): adjustable element plus two-finger gestures

Android has no direct-touch trait. With TalkBack on, the element has the `adjustable` role, so volume keys or swipe up and down step through posts, double tap goes to the next post, and the custom actions above are in the TalkBack actions menu. TalkBack passes two-finger drags to the app as one-finger drags, so the circle can be drawn with two fingers.

## Speech never talks over the screen reader

There are two `Narrator` implementations behind one interface (`src/narration`). With no screen reader running, `ExpoSpeechNarrator` speaks with the system voice through expo-speech. With a screen reader running, `ScreenReaderNarrator` hands the same text to the screen reader as an announcement, so the user hears one voice at their own configured speed instead of two voices at once. Moving to another post interrupts either one.

Known gap: screen reader announcements cannot be stopped mid-sentence by the app on every OS version; a new announcement replaces the old one (`queue: false`), which is what happens when the user moves on.

## Every state change has a voice and a haptic

| Event | Haptic | Voice |
| --- | --- | --- |
| Next post | light tap | the post |
| Previous post | rigid tap | the post |
| First post, end of feed, still loading | warning buzz | says which |
| Agent wakes | three rising taps | "Agent is awake..." |
| Agent sleeps | heavy then soft tap | "Agent is asleep. Back to scrolling." then the post |
| Circle in the mode you are already in | warning buzz | says so |

## Circle recognition

`src/gestures/circle.ts` is pure math with unit tests. A stroke is resampled to evenly spaced points, then the signed angle swept around the stroke's centroid is added up. A stroke counts as a circle when it sweeps at least 300 degrees, at least 85 percent of the turning is in one direction, and it is at least 60 points across. That accepts unclosed, overshot, squashed, shaky and drifting circles, and rejects lines, zigzags, U shapes and figure eights. Screen coordinates have y pointing down, so a positive sweep is clockwise.

A pan gesture collects the stroke and a tap gesture handles the halves; they race, so a finger that moves more than 12 points is a stroke and never a tap.

## Onboarding

First launch speaks how the gestures work, and the whole intro screen is one button. The sign-in screen has a header, two labeled text fields with hints, a live error region, and two labeled buttons. Without a screen reader the app also speaks a description of the sign-in screen. Typing a handle and app password without sight needs VoiceOver or TalkBack for the keyboard; "Continue without signing in" opens a public demo feed.

## Low vision

Black background, white 30 point bold text, a thick yellow border around the focused post. Text scales with the system font size up to 1.6 times, and long posts shrink to fit instead of scrolling.

## Try on a physical device

1. VoiceOver on: do taps on each half and both circles work without double tapping? (Direct touch.)
2. VoiceOver on: does the app's announcement cut off VoiceOver's reading of the hint, or the other way round?
3. VoiceOver direct touch disabled in the rotor: double tap, swipe up and down, magic tap, scrub.
4. Later, when Android is in scope: TalkBack swipe up and down, double tap, actions menu, two-finger circle.
5. Haptic patterns: are the five patterns distinguishable?
6. Speech with the ringer switch on silent (iOS silences expo-speech in silent mode unless an audio session is configured; that belongs with the Vapi audio work).
