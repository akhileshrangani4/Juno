# consumerhack

A social media app for blind and low-vision people. It reads each post aloud, one at a time. Tap the bottom half of the screen for the next post and the top half for the previous one. Draw a clockwise circle to wake the voice agent and a counter-clockwise circle to go back to scrolling.

## Run it

```bash
pnpm install
pnpm web          # browser
pnpm ios          # development build, needs Xcode
pnpm android      # development build, needs the Android SDK
```

No configuration is needed: signed out, the app shows a public Bluesky feed. Copy `.env.example` to `.env.local` to set a Convex deployment or a different feed. See [docs/building.md](docs/building.md) for binaries and [docs/accessibility.md](docs/accessibility.md) for how the gestures work with VoiceOver and TalkBack.

## Layout

| Path | What |
| --- | --- |
| `src/app` | expo-router routes: the main screen and sign in |
| `src/social` | `SocialProvider` interface; `bluesky/` is the only code allowed to import `@atproto` (lint enforces it) |
| `src/feed` | feed state: one focused post, paging |
| `src/gestures` | circle recognition math and the gesture surface |
| `src/narration` | `Narrator` interface, expo-speech and screen reader implementations, the narration script builder, description cache, earcons, preferences, and `requests.ts` for the voice agent ([docs/narration.md](docs/narration.md)) |
| `src/backend` | optional Convex client |
| `convex` | schema (`users`, `postDescriptions`) and functions, including the `describe` action that calls the vision model |

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`. CI runs them and bundles for iOS, Android and web.
