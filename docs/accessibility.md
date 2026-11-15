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
| Double tap (`onAccessibilityTap`) | Next post | Account settings |
| Actions rotor (swipe up or down to pick, double tap to run) | Next post, Previous post, Read this post again, Wake the agent, Brief or Full narration, Speech speed, Turn post sounds off or on | Back to scrolling, Hear the instructions, Account settings |
| Two-finger double tap (magic tap) | Wake the agent | Back to scrolling |
| Two-finger scrub (escape) | Warning buzz and "You are already scrolling." | Back to scrolling |

The rotor lists only these human-labeled actions (`surfaceActions` in `src/screens/surfaceActions.ts` and `narrationActions` in `src/narration/requests.ts`, both unit tested). Without a screen reader the narration actions offer Speak faster and Speak slower instead of Speech speed; with VoiceOver on, VoiceOver's own rate governs speech, so Speech speed only says so. On iOS the element is not `adjustable`, so a swipe up or down moves through the rotor's actions, not through posts.

The current narration is also the element's accessibility value, so VoiceOver reads the post again whenever focus returns to the feed, and "Read this post again" replays it on demand if an announcement was cut off.

### Android (unverified): adjustable element plus two-finger gestures

Android has no direct-touch trait. With TalkBack on, the element has the `adjustable` role, so volume keys or swipe up and down step through posts (the standard increment and decrement actions are added on Android only), double tap goes to the next post, and the labeled actions above are in the TalkBack actions menu. TalkBack passes two-finger drags to the app as one-finger drags, so the circle can be drawn with two fingers.

## Speech never talks over the screen reader

There are two `Narrator` implementations behind one interface (`src/narration`). With no screen reader running, `ExpoSpeechNarrator` speaks with the system voice through expo-speech. With a screen reader running, `ScreenReaderNarrator` hands the same text to the screen reader as an announcement, so the user hears one voice at their own configured speed instead of two voices at once. Moving to another post interrupts either one.

Known gap: screen reader announcements cannot be stopped mid-sentence by the app on every OS version; a new announcement replaces the old one (`queue: false`), which is what happens when the user moves on.

## Every state change has a voice and a haptic

| Event | Haptic | Voice |
| --- | --- | --- |
| Next post | light tap | the post |
| Previous post | rigid tap | the post |
| First post, end of feed, still loading | warning buzz | says which |
| Ten pages in a row hidden by the content filter | warning buzz | "No more posts could be shown right now." (not "end of the feed") |
| Agent connecting | one soft tap | "Waking the agent." (narration stops at once) |
| Agent listening | three rising taps | the agent says "I'm listening." |
| Agent sleeps (counter-clockwise circle, "goodbye", 30 s of silence, 10 minute limit) | heavy then soft tap | says why, e.g. "Agent is asleep. Back to scrolling.", then the post in focus |
| Agent cannot connect, microphone off, or agent not set up | error buzz | "I couldn't connect. Check your internet and try again." or how to turn the microphone on |
| Microphone, first time | - | explained by voice before iOS asks |
| Circle in the mode you are already in | warning buzz | says so |
| A stroke that is neither a tap nor a circle | two quick ticks | "Gesture not recognized.", at most once every 2.5 seconds, and never while a post or message is being read (the ticks and the on-screen hint still come at once) |
| A drag that scrolled a long post | none | none |
| Waiting at startup | none | "Loading" once, after 0.7 seconds; the screen is a labeled progress element |
| Signed in, but Bluesky is slow to answer | none | "Still connecting to Bluesky" after 4 seconds; the feed opens when it answers, or the sign-in screen if the saved session is no longer valid |

## Circle recognition

`src/gestures/circle.ts` is pure math with unit tests. A stroke is resampled to evenly spaced points, then the signed angle swept around the stroke's centroid is added up. A stroke counts as a circle when it sweeps at least 300 degrees, at least 85 percent of the turning is in one direction, and it is at least 60 points across. That accepts unclosed, overshot, squashed, shaky and drifting circles, and rejects lines, zigzags, U shapes and figure eights. Screen coordinates have y pointing down, so a positive sweep is clockwise.

A pan gesture collects the stroke and a tap gesture handles the halves; they race, so a finger that moves more than 12 points is a stroke and never a tap.

A long post scrolls inside the card at the same time as the pan collects the stroke, so a circle drawn over it is still recognized. When a stroke is not a circle, `classifyStroke` (`src/gestures/stroke.ts`, unit tested) decides whether it was a scroll: the card reported a scroll during the stroke and the stroke stayed within 30 degrees of vertical. A scroll gets no cue. A horizontal or diagonal stroke over the same post still gets "Gesture not recognized", even if it nudged the scroll. The card does not bounce at its ends, so a vertical drag on a post that fits, or one already at its end, scrolls nothing and still gets the cue.

## Onboarding

The intro screen is one button. Its label is the welcome line and its hint is the gesture instructions, so VoiceOver reads them on focus. The visible text says "Double tap to continue" when a screen reader is on and "Tap anywhere to continue" when it is off. Without a screen reader the app also speaks the instructions on first launch. The sign-in screen has a header, two labeled text fields with hints, a live error region, and two labeled buttons. Without a screen reader the app also speaks a description of the sign-in screen. Typing a handle and app password without sight needs VoiceOver or TalkBack for the keyboard; "Continue without signing in" opens a public demo feed.

## Narration settings

The narration actions above change a saved preference, say what changed ("Brief narration.", "Speed 1.5 times normal."), and read the current post again in the new way. The in-app speed goes from half to three times normal in quarter steps; three times normal is the fastest the iOS speech engine allows. iOS does not let apps read the Spoken Content rate, so the app starts at normal speed. With VoiceOver on, narration is spoken by VoiceOver at the user's own VoiceOver rate and the in-app speed does not apply, so the speed steps are not offered; the Speech speed action says that VoiceOver's own speaking rate applies and where to change it. The feed element's accessibility value is the current post's script, so VoiceOver reads it again when focus returns to the feed. See [narration.md](narration.md) for what is said and when.

## Low vision

Black background, white 30 point bold text, a thick yellow border around the focused post. Text scales with the system font size up to 1.6 times, and long posts keep that size and scroll inside the card. Taps on the halves still move between posts, and narration always reads the whole post.

## Try on a physical device

1. VoiceOver on: do taps on each half and both circles work without double tapping? (Direct touch.)
2. VoiceOver on: does the app's announcement cut off VoiceOver's reading of the hint, or the other way round?
3. VoiceOver direct touch disabled in the rotor: double tap, the Actions rotor (do the names read naturally?), Read this post again, magic tap, scrub.
4. A circle drawn over a long post that scrolls: does the post scroll a little and the circle still switch modes? Does a plain vertical scroll stay silent and leave the narration playing?
5. Later, when Android is in scope: TalkBack swipe up and down, double tap, actions menu, two-finger circle.
6. Haptic patterns: are the six patterns distinguishable?
7. Speech and earcons with the ringer switch on silent. The earcon player sets the audio session to play in silent mode, which should also make expo-speech audible; confirm both.
8. Earcons: are the four sounds quiet, short, and easy to tell apart, and does speech start right after them without a noticeable gap?
9. Speech rate with VoiceOver off: do "Speak faster" and "Speak slower" change speed audibly, and is the top step close to three times normal?
10. Does a description that arrives late get appended after the post without cutting it off?
