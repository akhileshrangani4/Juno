# Post narration and descriptions

When a post takes focus the app speaks a script built on the device from the post itself, with picture, video and hashtag descriptions from a vision model folded in when they are available. The model never supplies the post's words.

## The rule: the author's words come only from the post

A listener cannot check a paraphrase against the original, so no model ever rewrites, summarises or translates what the author wrote. This holds by construction:

- The Convex action (`convex/describe.ts`) returns structured parts only: one description per image (and, for images with alt text, only what the alt text leaves out), what a video opens on, and a short topic phrase for a pile of hashtags. Its JSON schema has no field for post text.
- `buildPostScript` in `src/narration/buildNarration.ts` assembles the script on the device. The spoken body is derived from `post.text` by fixed rules, and model parts only ever fill the media and tag slots after it. A unit test feeds hostile model output that tries to change the post's words and checks the body still matches the post byte for byte.
- Author alt text is also the author's words, so it is read verbatim. The model's addition follows it.

## Rules applied to the post text (no network needed)

| In the post | Spoken as |
| --- | --- |
| `I love #Paris` | "I love Paris" (CamelCase tags are split: `#NewYorkCity` is "New York City") |
| A run of two or more tags at the start or end, or tags on their own line | removed from the body, then "Tagged travel, photography, sunset, and four more." at the end, plus ", about …" when the model gave a topic |
| A link at the end | removed from the body, then "Links to nytimes.com." or the link card's title: "Links to Moon landing, from nytimes.com." |
| A link inside a sentence | "link to example.org" in place; link text that is not an address (`ESA/Webb`) stays, and its site is listed at the end |
| `@maya.bsky.social` | the display name when known ("Maya Ortiz"), otherwise "maya" |
| `🔥🔥🔥` | one 🔥 |
| A reply | "Alice, 2 hours ago, replying to Maya." or "continuing their thread" |
| A repost | "Reposted by Bob." first |
| Line breaks | a pause (a full stop, or a comma when the next line continues the sentence); no words change |

Order: who and what first, then media and quoted posts, then tags, then links.

## Modes

| Mode | Script |
| --- | --- |
| `full` (default) | everything above; a typical post with one picture is about 15 to 20 seconds at normal speed |
| `brief` | author, the first sentence (at most 30 words), then markers: "Has an image, a link, and four hashtags." |
| `verbatim` | the post text exactly, nothing else |
| `hashtags` | every hashtag in the post |
| `detailedImage` | the author, then longer descriptions written at the "detailed" level |

Standing preferences (mode, speech rate, earcons, skip hashtags, default detail) live in `src/narration/preferences.ts` and are saved with `keyValueStore`. The voice agent reads posts through `src/agent/narrationAdapter.ts`, which calls the same `buildPostScript`, and its speech settings (`src/agent/settings.ts`) are a view of these same preferences, so a change made by voice is what the feed uses next. Other code drives narration through `src/narration/requests.ts`: `narratePost(post, mode)`, `setNarrationMode`, `setSpeechRate`, `setSkipHashtags`, `setDefaultDetail`, `setEarcons`.

## Never waiting on the network

1. On focus, if the description is cached on the device, the full script is spoken at once.
2. If not, the deterministic script starts at once ("One image, with no description yet.") and the description is requested.
3. If it arrives while the same post is still in focus, "About the image: …" is appended after the current speech without interrupting it. If the user has moved on, it is only cached, and the full script is used if they come back.
4. While a post is being read, the next three posts are described in the background (full mode only), so the description is normally ready on arrival.

Any failure (no Convex URL, offline, rate limited, model error) leaves the deterministic script; nothing about the failure is spoken.

## Server: caching, dedupe, cost

- Model: `gpt-6-luna`, OpenAI's lowest-cost current vision model ($0.10 per million input tokens, $0.50 per million output tokens, November 2026), called through the Responses API with a strict JSON schema. Override it with the `DESCRIBE_MODEL` Convex environment variable. `OPENAI_API_KEY` exists only in the Convex deployment's environment.
- Source of truth: the app sends only the post URI, the detail level and a device id. The action fetches the post itself from Bluesky's public AppView (`app.bsky.feed.getPosts` on `public.api.bsky.app`) and builds the model input only from that response, mapped with the same `mapFeedItem` and `descriptionInput` the app uses. A URI that does not resolve to a post returns null with no model call and no row. Only `did:plc` post URIs are accepted, and a caption fetch goes only to a PDS with a public https host name, so the deployment never fetches a URL a caller chose.
- Cache: `postDescriptions` rows keyed by post URI, prompt version and detail level. Bumping `PROMPT_VERSION` in `convex/describePrompt.ts` re-describes posts under the new rules.
- Dedupe: a Convex mutation claims the key in a transaction before calling the model. A concurrent request for the same key sees the pending row and waits for its result (measured: six concurrent calls, one model call). The app also shares one in-flight request per post.
- No call at all for a post with no images, no video and no more than three tags in a pile.
- Spend cap: at most $2 of model spend per clock hour across the deployment, counted from the cost each response reports. The counter lives in one `describeUsage` row per hour. Each claim reserves $0.01 in the same transaction that claims the post, and completion replaces the reservation with the recorded cost, so calls in flight already count. One call cannot cost more than its reservation:
  - input: at most 10 images × about 3,200 tokens (the largest per-image count seen in evaluation), plus about 2,000 tokens of instructions and post text, is 34,000 tokens × $0.10 per million = $0.0034;
  - output: capped at 4,000 tokens × $0.50 per million = $0.002;
  - total: $0.0054, under the $0.01 reserved.

  So the true worst case is $2.00 an hour ($48 a day), whatever device ids or URIs a caller sends, because every call must be a real post and is described once per detail level. At the measured average of $0.00047 a described post, $2 covers about 4,000 described posts an hour. Reaching the cap turns descriptions off for every listener until the hour ends, which is the price of a hard bound.
- Per-device limit: 240 model calls per device per clock hour. A brisk listener at six posts a minute with half carrying media needs about 180. The device id is random and chosen by the app, so this only keeps one honest client from using up the shared budget; the spend cap is the bound. The database stores only a SHA-256 digest of the id, in that hour's counter row, and counter rows from past hours are deleted as new claims arrive. Description rows hold no device information.
- Text in images: the model also lists every piece of visible text in each image (`visible_text`). For an image with author alt text, only the alt text and the model's addition are spoken, so the server appends any listed text that neither already contains ("Text in the image reads “© PONZINI PHOTOGRAPHY”.").
- Names: the model uses a person's name only when the post text or alt text says that person is pictured, always credited to the post ("whom the post names as …"). It records that decision first in a `names_shown` field the app never reads, which made a small model follow the rule reliably.
- As a second check, only images on `cdn.bsky.app` and video thumbnails on `video.bsky.app` under the post author's DID are sent to the model.
- Prompt caching is explicit and limited to the shared instructions, so per-post images are never billed at the cache-write rate.
- Video: the model sees the thumbnail (usually the opening frame), alt text and, when the record has captions, the start of the WebVTT captions fetched from the author's PDS. Descriptions start with "Opens on" and never claim the video was watched.

## Earcons

A short, quiet sound plays before a post's narration: `image` one high bell note (160 ms), `video` two rising notes (220 ms), `repost` two low blips (185 ms), `reply` one falling glide (220 ms). One per post, most informative first: video, image, reply, repost. Speech starts as the sound ends. The sounds are synthesized by `scripts/generate-earcons.py` and committed in `assets/sounds`. The audio session is set to play in silent mode and mix with other audio.
