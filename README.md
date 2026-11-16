<p align="center"><img src="assets/logo/juno-mark-transparent-1024.png" alt="Juno logo" width="160"></p>

# Juno

Juno is a voice-first, accessibility-first Bluesky client for blind and low-vision people. It reads your feed aloud one post at a time, and everything in it works by touch gestures that need no sight or by talking to its voice agent.

## What it does

- **Posts are read aloud, one at a time.** Each post is spoken as who wrote it, when, and what it says, followed by its pictures and videos described by a vision model. The author's own words always come from the post itself, never from a model. A short sound before each post tells you whether it has a picture or video, is a reply, or is a repost.
- **Gestures that need no sight.** Tap the bottom half of the screen for the next post and the top half for the previous one, or swipe right and left. Swipe up to hear the replies. Hold two fingers on the screen to like a post. Every action answers with a voice line and a haptic, and it all works with VoiceOver on.
- **A voice agent you can talk to.** Draw a clockwise circle and Juno's agent says "I'm listening." Ask it to post, reply, repost, like, read the comments or sum them up, change how posts are read, or undo your last action. Nothing is published until Juno reads the draft back to you and you clearly say yes, and even then you have five seconds to say "undo".
- **A camera that helps you frame the shot.** Swipe down to open the camera. Juno tells you "Move left", "Tilt up" or "Hold steady" until the subject is in frame, says what is in the picture after you take it, and can post it with its image description read back to you first. Pictures are only sent for a description after you agree once.
- **Translation.** A post in a language you don't read is translated into yours and always labeled, for example "Translated from Spanish". The original is one request away.
- **Sign in with just your handle.** Your password goes only on Bluesky's own sign-in page, opened in the iPhone's system sheet, so saved passwords, passkeys and Face ID work as they do in Safari. You can also listen to a public feed without signing in.
- **Memory.** When you're signed in, you can tell the agent things to remember ("remember that I like birds"), ask what it remembers, and have it forget them.

## How it is built

- **Expo React Native** (TypeScript, expo-router, development builds) is the app. It is iOS first: the code stays cross-platform, but it is built and tested on iPhone.
- **Bluesky's AT Protocol** through `@atproto/api` gives the feed, posting, likes and replies. Sign-in uses Bluesky OAuth with only the permissions the app needs, and only `src/social/bluesky` may import the AT Protocol libraries.
- **Convex** is the backend: it serves the OAuth client metadata, describes and translates posts, describes camera pictures, and keeps per-user memory, with rate limits and an hourly spending cap on every model call.
- **Vapi** runs the voice agent's call: speech recognition, the agent's voice, and the model. Every action the agent takes is a tool that runs on the phone, so the app decides what is said and published.
- **OpenAI** models write the picture descriptions, translations and camera checks (called from Convex) and drive the voice agent (through Vapi).
- **Supermemory** stores what the user asks the agent to remember, one container per Bluesky account, reached only through Convex with proof that the request comes from that account.

## Gestures

| Gesture | Feed | Comments | Agent awake |
| --- | --- | --- | --- |
| Tap the bottom half, or swipe right | Next post | Next reply | Account settings (tap) |
| Tap the top half, or swipe left | Previous post | Previous reply | Hear the instructions (tap) |
| Swipe up | Open the replies | Says the replies are already open | Warning buzz |
| Swipe down | Open the camera | Back to the posts | Warning buzz |
| Hold two fingers still for 1.4 seconds | Like or remove the like | Like or remove the like | Like or remove the like |
| Clockwise circle | Wake the agent | Wake the agent | Says the agent is already awake |
| Counter-clockwise circle | Says you are already scrolling | Says you are already scrolling | Put the agent to sleep |

In the camera, tap the bottom half to take or keep a picture and the top half to switch cameras or take another. Swipe up or draw a counter-clockwise circle to go back to the feed. With VoiceOver on, the same actions are in the actions rotor. [docs/accessibility.md](docs/accessibility.md) has the full map, what each action says, and how the gestures work with VoiceOver.

## Run it

```bash
pnpm install
pnpm web          # browser
pnpm ios          # development build, needs Xcode
```

No configuration is needed: signed out, the app plays a public Bluesky feed. Copy `.env.example` to `.env.local` to point it at a Convex deployment or a Vapi key; every variable is described there. [docs/building.md](docs/building.md) covers Release builds for the simulator and for a physical iPhone, the Convex deployment and its secrets, and how the voice agent is tested.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`. CI runs them and bundles for iOS, Android and web.

## Docs

- [docs/accessibility.md](docs/accessibility.md): gestures, VoiceOver, sign-in, and what every screen says
- [docs/narration.md](docs/narration.md): how a post is turned into speech, descriptions and translation
- [docs/camera.md](docs/camera.md): framing guidance, descriptions, and what is sent where
- [docs/building.md](docs/building.md): builds, Convex, and the voice agent's model
- [docs/demo.md](docs/demo.md): the three-minute demo script

## What is next

- A For You feed picked by Bluesky from what you like, with "more like this" and "less like this", and refreshing the feed by voice.
- Trying every gesture and announcement with VoiceOver on physical iPhones, with blind testers.
- Making sign-up possible without sight: Bluesky's human check can be a picture puzzle with no audio option.
- Talking to the agent by holding one finger on the screen.
- Android and TalkBack, which are written but not yet verified.
