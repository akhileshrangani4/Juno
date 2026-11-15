# Accessibility decisions

Juno is built for people who cannot see the screen. Most of them run VoiceOver (iOS) or TalkBack (Android), and both screen readers intercept touches: a single tap moves the screen reader cursor instead of reaching the app, and a one-finger drag is read as "explore by touch". Left alone, the half-screen taps and the circle gesture would never fire for the people the app is for.

The app is iOS first: VoiceOver is the supported screen reader for now. The code stays cross-platform and the TalkBack handling below is in place, but TalkBack is unverified.

Nothing in this document has been tried with VoiceOver or TalkBack on a physical phone yet. Simulators and cloud phones cannot run them properly. The checklist at the end is what to try on a real device.

## The main screen is one accessibility element

The feed and the agent screen are a single element (`GestureSurface` in `src/gestures`, configured in `src/screens/MainScreen.tsx`). The post text inside it is not exposed as separate elements, because the app narrates the post itself and a second set of focus stops would only get in the way.

### iOS: direct touch

On iOS the element carries the `UIAccessibilityTraitAllowsDirectInteraction` trait. React Native has no typed prop for it, but its native role parser accepts the string `allowsDirectInteraction` (see `accessibilityPropsConversions.h` in React Native 0.88), so the screen passes it as `accessibilityRole` with a cast. While VoiceOver focus is on a direct-touch element, touches inside it go straight to the app, so taps and circles behave exactly as they do with VoiceOver off. This is the same mechanism piano and drawing apps use.

The element covers the whole screen and is the only element, so focus lands on it when the screen opens. VoiceOver reads its label and hint once, which explains the gestures.

Users can turn direct touch off per app in the VoiceOver rotor. For them, and as a general fallback, the element also answers:

| Screen reader action | Feed | Comments | Agent mode |
| --- | --- | --- | --- |
| Double tap (`onAccessibilityTap`) | Next post | Next reply | Account settings |
| Actions rotor (swipe up or down to pick, double tap to run) | Next post, Previous post, Like or Remove like, Open comments, Read this post again, Wake the agent, Brief or Full narration, Speech speed, Turn post sounds off or on, Gesture help | Next reply, Previous reply, Like or Remove like, Back to posts, Read this reply again, Brief or Full narration, Speech speed, Turn post sounds off or on, Gesture help | Back to scrolling, Hear the instructions, Account settings |
| Two-finger double tap (magic tap) | Wake the agent | Wake the agent | Back to scrolling |
| Two-finger scrub (escape) | Warning buzz and "You are already scrolling." | Back to posts | Back to scrolling |

The like action's label follows the state of the post or reply in focus: "Like" when the user hasn't liked it, "Remove like" when they have.

The rotor lists only these human-labeled actions (`surfaceActions` in `src/screens/surfaceActions.ts`, unit tested for every view and both like states, and `narrationActions` in `src/narration/requests.ts`). Without a screen reader the narration actions offer Speak faster and Speak slower instead of Speech speed; with VoiceOver on, VoiceOver's own rate governs speech, so Speech speed only says so. A narration action in the comments view reads the current reply again in the new way. On iOS the element is not `adjustable`, so a swipe up or down moves through the rotor's actions, not through posts.

The current narration is also the element's accessibility value, so VoiceOver reads the post again whenever focus returns to the feed, and "Read this post again" replays it on demand if an announcement was cut off.

### Android (unverified): adjustable element plus two-finger gestures

Android has no direct-touch trait. With TalkBack on, the element has the `adjustable` role, so volume keys or swipe up and down step through posts (the standard increment and decrement actions are added on Android only), double tap goes to the next post, and the labeled actions above are in the TalkBack actions menu. TalkBack passes two-finger drags to the app as one-finger drags, so the circle can be drawn with two fingers.

## Speech never talks over the screen reader

There are two `Narrator` implementations behind one interface (`src/narration`). With no screen reader running, `ExpoSpeechNarrator` speaks with the system voice through expo-speech. With a screen reader running, `ScreenReaderNarrator` hands the same text to the screen reader as an announcement, so the user hears one voice at their own configured speed instead of two voices at once. Moving to another post interrupts either one.

Known gap: screen reader announcements cannot be stopped mid-sentence by the app on every OS version; a new announcement replaces the old one (`queue: false`), which is what happens when the user moves on.

## Every state change has a voice and a haptic

| Event | Haptic | Voice |
| --- | --- | --- |
| Next post (bottom-half tap or swipe right) | light tap | the post, ending with "12 replies." when it has replies |
| Previous post (top-half tap or swipe left) | rigid tap | the post |
| Like (press and hold) | success buzz | "Liked." |
| Remove like (press and hold on a liked post) | soft tap | "Like removed." |
| Press and hold while signed out | warning buzz | "You need to sign in to like posts...", and nothing changes |
| Like or unlike fails | warning buzz | "Could not like this. Nothing changed." (or "Could not remove the like.") |
| Like or unlike gets no answer (network down) | warning buzz | "Could not like this: Bluesky can't be reached. Check your connection. Nothing changed." The user stays signed in. |
| Open comments (swipe up) | light then medium tap | "12 replies. Swipe down to go back." then the first reply, or "No replies yet. Swipe down to go back." |
| Replies still loading after 0.7 seconds | none | "Loading replies." |
| Replies fail to load | warning buzz | "Could not load the replies. Back to posts." then the post |
| Next or previous reply | light or rigid tap, as for posts | "Reply 2 of 12, from Maya, replying to Sam." then the reply's text and media |
| First reply, last reply | warning buzz | "This is the first reply." or "That was the last reply. Swipe down to go back." Comments never close by themselves |
| Back to posts (swipe down in comments) | medium then light tap | "Back to posts." then the same post |
| Swipe up while already in comments | warning buzz | "You are already in the replies. Swipe down to go back." |
| Swipe down on the feed | one selection tick | "The camera is coming soon." |
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

## Gesture map

| Gesture | Feed | Comments | Agent mode |
| --- | --- | --- | --- |
| Tap the top half, or swipe left | Previous post | Previous reply | Hear the instructions (tap); a swipe gets a warning buzz |
| Tap the bottom half, or swipe right | Next post | Next reply | Account settings (tap); a swipe gets a warning buzz |
| Swipe up | Open comments | Says comments are already open | Warning buzz |
| Swipe down | "The camera is coming soon." | Back to posts | Warning buzz |
| Press and hold (0.6 seconds) | Like or remove like on the post | Like or remove like on the reply | Like or remove like on the post, confirmed in the agent's voice |
| Clockwise circle | Wake the agent | Wake the agent | Says the agent is already awake |
| Counter-clockwise circle | Says you are already scrolling | Says you are already scrolling | Back to scrolling |

The rule is that the opposite gesture goes back: swipe up enters comments and swipe down leaves them, and the narrator says so on the way in. There is no double-tap gesture anywhere.

A pan gesture collects the stroke, a long-press gesture handles press and hold, and a tap gesture handles the halves. All three race and none waits for another, so a tap runs the moment the finger lifts. A finger that moves more than 12 points is a stroke, and one held still for 0.6 seconds is a hold.

When the finger lifts, `classifyStroke` (`src/gestures/stroke.ts`) sorts the stroke in this order:
1. **Circle** (`recognizeCircle`, unchanged). Circles come first, so the start of a circle is never taken for a swipe.
2. **Scroll.** The card scrolled during the stroke, the stroke stayed within 30 degrees of vertical, and it took longer than a flick (0.35 seconds). A scroll fires nothing, not even `onUnrecognizedStroke`.
3. **Swipe** (`recognizeSwipe` in `src/gestures/swipe.ts`). A swipe is at least 60 points long, within 30 degrees of one axis, at least 80 percent straight (its length divided by the distance travelled), and over within 1.5 seconds. The limit is generous, so an unhurried swipe still counts.
4. **Unrecognized** otherwise: `onUnrecognizedStroke` fires and the main screen plays the cue.

Long posts and swipe up: on a post that fits the card, any swipe up opens comments. On a long post, a quick flick up (under 0.35 seconds) opens comments, and a slower vertical drag scrolls the post. While a screen reader is on, touch scrolling of the card is off. A VoiceOver user hears the whole post and has the actions above, so for them a vertical stroke never turns into a scroll.

A long post scrolls inside the card at the same time as the pan collects the stroke, so a circle drawn over it is still recognized. The card does not bounce at its ends, so a vertical drag on a post that fits, or one already at its end, scrolls nothing and counts as a swipe.

## Comments

Replies come from the post's thread through `SocialProvider.getReplies`, which uses the public AppView when signed out. They are read in thread order, depth first, so each reply is followed by its answers. A reply that answers another reply says who it answers. The content filter applies to replies too, and a hidden reply's answers are hidden with it. Each post's replies are fetched once per session. Leaving and coming back keeps your place. Waking the agent closes the comments.

The voice agent reaches the same replies: "read the comments" reads up to ten aloud, and "what are people saying" hands the replies to the agent, marked as other people's words, to sum up in a sentence or two. While the agent is awake, every confirmation from these gestures ("Liked", "Like removed", the sign-in message) goes through the agent's voice, never on-device speech, and before the call is live a haptic is the only answer. Liking from the agent, by press and hold, or undoing either uses the same provider calls and shares one record of what is liked, so nothing is liked twice.

## Onboarding

The intro screen is one button. Its label is the welcome line and its hint is the gesture instructions, so VoiceOver reads them on focus. The visible text says "Double tap to continue" when a screen reader is on and "Tap anywhere to continue" when it is off. Without a screen reader the app also speaks the instructions on first launch.

## Sign in and sign up

Juno never shows, asks for, or accepts an account password on its own screens. Signing in takes only a handle; the password goes on Bluesky's own page, opened in the iOS system authentication sheet (ASWebAuthenticationSession through expo-web-browser), never in an embedded web view. That sheet is Safari, so VoiceOver, saved passwords, passkeys and Face ID work there as they do in Safari. The sheet shares Safari's cookies, so "Remember this account on this device" on Bluesky's page carries over.

### How each screen speaks

Every screen has one status line at the top that says what is happening. With VoiceOver on, focus moves to that line whenever it changes, so VoiceOver reads it once and the user can swipe back to it. With VoiceOver off, the app speaks it. The two-finger scrub (escape) goes back one step.

| Screen | What it says on arrival | Controls, in order |
| --- | --- | --- |
| First screen | "Welcome to Juno. You can sign in with your Bluesky handle, create a new Bluesky account, or listen to a public feed without signing in." If the session ended, it first says "Your Bluesky sign-in has ended. Sign in again to pick up where you left off." | Sign in, Create an account, Listen without signing in |
| Sign in | "Type or dictate your Bluesky handle, then double tap Continue." | Bluesky handle field, Continue, Use an app password instead, Back |
| Read-back | "maya dot bsky dot social. Double tap Continue if that's right." A bare name is offered with bsky.social: "Did you mean maya dot bsky dot social?" | Continue, Change handle, Use an app password instead, Back |
| Opening | "Bluesky's sign-in page will open. First, iPhone asks whether Juno may use a website, usually bsky.social, to sign in. Choose Continue. Then enter your password on Bluesky's page. You'll come back here when you're done." The sheet opens when that finishes (at most 8 seconds). The middle sentence warns about the system alert ("“Juno” Wants to Use “bsky.social” to Sign In", with Cancel and Continue; iOS takes the name from the app's display name) that iOS shows before every sign-in sheet; choosing Cancel there ends the attempt and Juno says so. It is left out on platforms without that alert. | |
| Outcome | Success: "Signed in as Maya." Cancel: "Sign in was cancelled. Double tap Continue to try again, or choose Use an app password instead." Failure: a plain reason (no connection, or Bluesky couldn't finish). A handle that doesn't resolve: "I couldn't find maya dot bsky dot social on Bluesky. Check the spelling and try again.", with the entry kept. | |
| App password | Explains what an app password is and where to make one. Refuses anything that is not in the app-password format, so a main password typed by mistake is never sent. | Handle, App password, Sign in, Back |
| Account (from the agent screen) | "Signed in as Maya." | Back to the feed, Sign out |
| Sign out? | "Sign out of Bluesky on this device? You'll need to sign in again to read your timeline." | Sign out, Cancel |
| Can't reach Bluesky (at launch) | "Bluesky couldn't be reached, so your timeline can't load yet. You're still signed in. Check your connection, then choose Retry, or listen to a public feed without signing in." Retry says "Trying Bluesky again." | Retry, Listen without signing in |

The handle field accepts typing and keyboard dictation. Entries are trimmed, lower-cased, a leading @ is dropped, a spoken "dot" between words becomes a period, dictated "Maya. Bsky. Social." becomes maya.bsky.social, and a name with no domain becomes name.bsky.social. Read-back spells dots as "dot" and hyphens as "dash". The wording is unit tested (`src/auth`).

If the session can no longer be refreshed (the user revoked it, or it expired after Bluesky's session lifetime), the feed stays where it was and the first screen opens on top of it, says the sign-in has ended, and keeps the handle for the next sign in. Signing in again as the same account returns to the same post. A refresh that fails only because the network is down signs nobody out.

At launch with a stored session, restoring has three outcomes, for both OAuth and app-password sessions (`RestoreResult` in `src/social/types.ts`):

- **Restored:** the feed opens.
- **Invalid:** Bluesky refused the token or the refresh. The stored session is removed, and the first screen says the sign-in has ended, with the handle kept.
- **Unreachable:** a network error or timeout. The stored session is left untouched, and the "Can't reach Bluesky" screen above appears. Listen without signing in plays the public feed for this launch only, so the next launch tries the timeline again.

The loading screen changes to "Still connecting to Bluesky" after 4 seconds. Waiting is capped at 20 seconds, after which the "Can't reach Bluesky" screen appears and is announced. Unit tests cover all three outcomes for both session kinds (`src/social/bluesky/__tests__`), and the cap and the screens (`src/session/__tests__/slowRestore.test.tsx`).

Sign out is reachable from the agent screen's Account settings and asks for confirmation. Confirming deletes the tokens, the DPoP key and the stored account from the keychain first, then says "Signed out". It doesn't wait for the network: Bluesky is asked to revoke the session afterwards, in the background, from an in-memory copy, and that attempt is abandoned after 5 seconds. A revoke that fails or never answers isn't reported, because the device no longer holds anything that can use the session. The button reads "Signing out" and is marked busy for the moment the keychain takes. The voice agent can call `useSession().signOut()` after its own spoken confirmation.

### Bluesky's sign-up, checked with a screen reader's view of the page (2026-11-15)

Create an account runs Bluesky's own sign-up inside the same system sheet, after the same warning about the iOS alert: bsky.social's authorization server advertises the OAuth `prompt=create` value, so Juno starts the OAuth flow with it and the user comes back signed in. The page was checked in a browser through its accessibility tree, without submitting the form.

- **Step 1, Choose a username.** The field is labeled "Type your username". The rules ("Use 3–18 letters, numbers or hyphens") and the full handle preview are plain text after the field. An invalid name produces "The username is invalid" in an ARIA `alert`, which screen readers announce.
- **Step 2, Your account.** "Email" and "Password" are labeled fields, with a "Make visible" button and a labeled password strength meter. There is no birthday field in this flow.
- **Step 3, Verify you are human.** An hCaptcha checkbox labeled "'I am human', Select in order to trigger the challenge, or to bypass it if you have an accessibility cookie". Selecting it opened a visual puzzle ("Click the TWO matching shapes"). The puzzle image's label tells screen reader users to use the accessibility options, but the options menu offered only "Accessibility: Retrieve Cookie". There was no text challenge and no audio challenge.
- **Smaller problems.** "Sign up" is not a heading, the step progress bar has no label, and the language picker's accessible name is a random string ("vHJQ4A").

**Can a blind user finish it alone? Not reliably.** The visual puzzle has no non-visual alternative on this page. hCaptcha's accessibility cookie requires a separate sign-up with hCaptcha, and it is a cross-site cookie that Safari blocks by default. Blind users on AppleVis (November 2026) report that the cookie does not work for Bluesky and that hCaptcha support told them Bluesky has not enabled it. The same users report that sign-up in the official Bluesky iPhone app passed the human check with no puzzle, likely through iOS's automatic verification. Whether that also happens in Juno's system sheet is unverified until it is tried on a physical iPhone.

The app says this before the sheet opens ("That check may be a picture puzzle with no audio option, so you may need a sighted helper for that one step"). The assisted path:

1. Try Create an account in Juno. If the human check passes without a puzzle, the user finishes alone.
2. Otherwise create the account in the official Bluesky app, or have a sighted helper complete only the human check once, on any device.
3. Then sign in to Juno with just the handle. Signing in never shows the puzzle.

The sign-in page itself reads well: "Username or Email" is prefilled from the handle Juno sends, "Password" is labeled and focused, and Sign in and Cancel are labeled buttons.

## Narration settings

The narration actions above change a saved preference, say what changed ("Brief narration.", "Speed 1.5 times normal."), and read the current post again in the new way. The in-app speed goes from half to three times normal in quarter steps; three times normal is the fastest the iOS speech engine allows. iOS does not let apps read the Spoken Content rate, so the app starts at normal speed. With VoiceOver on, narration is spoken by VoiceOver at the user's own VoiceOver rate and the in-app speed does not apply, so the speed steps are not offered; the Speech speed action says that VoiceOver's own speaking rate applies and where to change it. The feed element's accessibility value is the current post's script, so VoiceOver reads it again when focus returns to the feed. See [narration.md](narration.md) for what is said and when.

## Gesture practice and stuck hints

Activating the intro opens gesture practice (`src/onboarding`): the user tries a top-half tap, a bottom-half tap, a clockwise circle and a counter-clockwise circle, one at a time. Each success gets the spoken result and that gesture's own haptic from the feed; a wrong gesture or a stroke the recognizer rejects gets a spoken hint naming what happened and how to retry, with a tip every third miss and no attempt limit. Input in the 0.7 seconds after a step changes is ignored, so a habitual double tap counts once.

The practice area is one direct-touch element whose label is the text last spoken, so VoiceOver focus always reaches the current instruction. Below it are two labeled buttons, Repeat and Skip practice, which VoiceOver can reach by touch even while direct touch passes gestures through; the element also has labeled Repeat and Skip actions and the escape scrub skips. Voice Control users can say "Tap Skip practice". Practice runs once as part of onboarding and can be replayed from "Practice the gestures", the last button on the first screen (after Sign in, Create an account and Listen without signing in) and on the account screen. Finishing or skipping practice returns to that screen, which announces its status line again (or moves VoiceOver focus to it).

Everything practice teaches comes from one list, `GESTURES` in `src/onboarding/gestures.ts`: each entry has the gesture, its feed action, the spoken instruction, retry and tip copy, the stuck hint, its haptic and the feed modes where it applies. The practice steps, the help summary and the stuck hints all read from that list, so changing the gesture set means editing the list.

After onboarding, the feed (through `DiscoverySurface`, a thin wrapper around `GestureSurface`) adds, while scrolling, a Gesture help action that speaks a one-paragraph summary of the gestures, and, for the first five sessions, a stuck hint: after three unrecognized strokes in a row, or 20 seconds of silence after narration ends, it speaks the gesture the user most likely wanted (a curved stroke suggests the clockwise circle, a vertical or horizontal swipe suggests the matching half tap, a small stroke, usually a slipped tap, suggests nothing, and a long idle suggests the next gesture not yet used). A hint never cuts off a post: VoiceOver actions, magic tap and escape count as activity like gestures do, the idle clock only runs once narration has finished, and a hint that comes due while a post, its earcon or a picture description that arrived late is being spoken waits until it ends, and is dropped if the agent is awake by then. Hints stop for good once each gesture has been used on the feed. While the agent is awake the detector does not run and Gesture help is not offered, so nothing speaks on the device over the agent; returning to scrolling starts the stroke count and the idle clock over. `gestureHelp()` is the seam for the voice agent to answer "how do I..." later.

## Low vision

Black background, white 30 point bold text, a thick yellow border around the focused post. Text scales with the system font size up to 1.6 times, and long posts keep that size and scroll inside the card. Taps on the halves still move between posts, and narration always reads the whole post. Gesture practice works the same way: each half of the practice area keeps exactly half of the height, so the halves on screen stay the halves taps are judged by, and the step title and spoken text grow with the system size and scroll inside their half instead of shrinking or being cut off. From 1.2 times the normal size, Repeat and Skip practice stack at full width so neither label breaks mid-word.

## Try on a physical device

1. VoiceOver on: do taps on each half and both circles work without double tapping? (Direct touch.)
2. VoiceOver on: does the app's announcement cut off VoiceOver's reading of the hint, or the other way round?
3. VoiceOver direct touch disabled in the rotor: double tap, the Actions rotor (do the names read naturally?), Read this post again, magic tap, scrub.
4. A circle drawn over a long post that scrolls: does the post scroll a little and the circle still switch modes? Does a slow vertical drag only scroll, stay silent, and leave the narration playing, and does a quick flick up open comments? Is 0.35 seconds the right line between them?
5. Swipes with VoiceOver direct touch on: do all four swipes and press and hold reach the app?
6. Later, when Android is in scope: TalkBack swipe up and down, double tap, actions menu, two-finger circle.
7. Haptic patterns: are the thirteen patterns distinguishable?
8. Speech and earcons with the ringer switch on silent. The earcon player sets the audio session to play in silent mode, which should also make expo-speech audible; confirm both.
9. Earcons: are the four sounds quiet, short, and easy to tell apart, and does speech start right after them without a noticeable gap?
10. Speech rate with VoiceOver off: do "Speak faster" and "Speak slower" change speed audibly, and is the top step close to three times normal?
11. Does a description that arrives late get appended after the post or reply without cutting it off?
12. Sign in: does focus land on the status line after each step, and does "Bluesky's sign-in page will open" finish before the sheet appears? Does the system's "Juno wants to use bsky.social to sign in" alert read correctly?
13. Inside the sheet: does VoiceOver read Bluesky's page, do saved passwords, passkeys and Face ID fill it, and does the sheet return to Juno announcing the result?
14. Create an account: does the human check show a puzzle on a real iPhone, or does iOS's automatic verification pass it?
15. Gesture practice with VoiceOver on: does focus land on the practice area, do taps and circles pass through, and can the Repeat and Skip practice buttons be reached by touch? Is the Gesture help action on the feed reachable from the rotor while direct touch is on?
