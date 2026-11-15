# Post narration and descriptions

When a post takes focus Juno speaks a script built on the device from the post itself, with picture, video and hashtag descriptions from a vision model folded in when they are available. The model never supplies the post's words.

## The rule: the author's words come only from the post

A listener cannot check a paraphrase against the original, so no model ever rewrites or summarises what the author wrote, and a translation is never passed off as the author's words (see "Posts in other languages"). This holds by construction:

- The Convex action (`convex/describe.ts`) returns structured parts only: one description per image (and, for images with alt text, only what the alt text leaves out), what a video opens on, and a short topic phrase for a pile of hashtags. Its JSON schema has no field for the post text itself; the only field derived from it is a translation, which the app always speaks under its label.
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

## Posts in other languages

A post in a language the listener does not read is spoken as a labeled translation: "Ana, 2 hours ago. Translated from Spanish: …", then media, tags and links as usual. The label is the same words every time, names the source language, and comes before every translated piece, the post text and translated alt text alike. The original is one request away: verbatim mode, or "read the original" to the voice agent.

- **The listener's languages**: every language in the device's preferred-languages list is read as written (someone who lists English and Hindi never hears Hindi translated), and translations go into the first one. Preferences (`translate`, `translateInto`, `keepLanguages` in `src/narration/preferences.ts`) override this and persist. They change by voice ("don't translate Spanish", "translate everything into English", "stop translating", "translate into my phone's languages") and by the VoiceOver action "Stop translating posts" / "Translate posts".
- **Whether a post needs it** (`textNeedsTranslation` in `src/narration/buildNarration.ts`, run on the device to decide whether to ask and again on the server, both on the same text: the author's words without hashtags, mentions, links or emoji, so `#LoDelRolEsElMejor` never makes an English post look Spanish; the rules are `translationCheck` in `src/narration/language.ts`): the record's declared `langs` are a hint, not the truth. The text decides first by script (Arabic, Hebrew, Devanagari, Japanese kana, Han, Hangul, Cyrillic, Thai and others), then for Latin-script text by counting common words of ten languages (English, Spanish, French, German, Portuguese, Italian, Dutch, Turkish, Polish, Indonesian), where a declaration takes more evidence to overrule than no declaration. It is conservative: a post with fewer than 12 letters of text (a Chinese, Japanese or Korean character counts as two), a declaration alone on fewer than four Latin-script words ("Silver sketch" declared Portuguese), or one mostly in the listener's language with a foreign phrase in it, is read as written. A post mostly in another language is translated whole, and the prompt keeps any part already in the listener's language word for word. Han characters count as Chinese for a Japanese reader only when the post declares Chinese. The model also reports the language it found, and the server keeps a translation only when that language is one the listener does not read.
- **The server** gets the target and the languages not to translate along with the URI, so the cache key includes them. The model returns the source language and the translation in their own fields; it is told to translate everything faithfully (nothing summarised, softened or explained), keep names, handles, hashtags, links, numbers and emoji, keep tone and profanity, and treat the text as content, never instructions. It translates exactly the body Juno would speak (links and mentions replaced, trailing tag piles removed), with inline hashtags kept as `#tag` so they stay untranslated; the app speaks them like the author's own inline tags. Visible text in an image is given in the original, then "which means" and its translation; the model returns only the bare translation, and code writes the sentence once.
- **Brief mode** uses the translation's first sentence, cut by code. **Verbatim** (the VoiceOver action "Read exactly" while scrolling) reads the original in a voice for its language when the phone has one (`Narrator.canSpeak`), and otherwise says "This voice can't read Spanish aloud, so here is the translation." and reads the labeled translation.
- **Not translated yet**: foreign text is never read in the wrong voice. Juno says who posted, then "This post is in another language and is being translated." The translation is appended if it lands while the post is still in focus, and is otherwise cached for when the listener comes back. Prefetch of the next three posts includes translations (in brief mode too, where pictures are not described).
- **Failure**: "This post is in another language and could not be translated right now." When the model names a foreign language but returns an empty, blank or unchanged translation, the server records the language as untranslated and the listener hears "This post is in Spanish and could not be translated right now."; the foreign text is never read in the listener's voice. Nothing is invented and the rest of the post (media, tags, links) is read as usual.
- **The voice agent** reads through the same script, so a foreign post's text reaches it only as the labeled translation. `read_post` with mode `translation` ("translate this") and `exact` ("read the original") cover the two requests. The agent's voice cannot pronounce other languages, so `exact` says so ("I can't pronounce Spanish well, so here is the translation."), gives the labeled translation, and ends "To hear the original, draw a circle counter-clockwise to put me to sleep, then choose Read exactly from the VoiceOver actions." and `change_narration` covers the preferences. A reply or repost read-back of a foreign post quotes its labeled translation, and until there is one names the post by its language without quoting it ("Reposting Ana's post, which is in Spanish, to your followers."); what the user writes is never translated.

Cost and reach, measured in November 2026: a translated text-only post costs on average $0.00014 (at most $0.00033 across the evaluation), about 2.5 seconds median. On 400 posts of Bluesky's Discover feed, an English-only listener would have 132 (33%) translated; 58 of those (15% of the feed) are text-only and make a model call that did not happen before, and the rest carry media and were already described. A post in the listener's own language still makes no call when it has no media. With the next three posts prefetched, a listener who hears each post out found every translation ready in a simulation over that feed; one who skims at 1.5 seconds a post meets "being translated" on about a third of foreign posts, and one who flicks through at 0.7 seconds on most of them (88%).

## Never waiting on the network

1. On focus, if the description is cached on the device, the full script is spoken at once.
2. If not, the deterministic script starts at once ("One image, with no description yet.") and the description is requested.
3. If it arrives while the same post is still in focus, "About the image: …" is appended after the current speech without interrupting it. If the user has moved on, it is only cached, and the full script is used if they come back.
4. While a post is being read, the next three posts are described in the background (full mode only), so the description is normally ready on arrival.

Any failure (no Convex URL, offline, rate limited, model error) leaves the deterministic script; nothing about the failure is spoken.

The voice agent follows the same rule. `read_post` and `go_to_post` answer at once with a description already on the phone, or without one while it is fetched in the background; if it lands while the same post is in focus, the app says "About the image: …" in the agent's voice, and otherwise it is only cached. An explicit "describe the picture" waits up to 2.5 seconds, then reads what it has and says a fuller description is on its way. No agent tool waits longer than 3 seconds (`TOOL_CEILING_MS` in `src/agent/toolHandlers.ts`): a slower one tells the model it is still working, its result reaches the model when it lands, and tools that touch the undo history wait until then.

## Server: caching, dedupe, cost

- Model: `gpt-6-luna`, OpenAI's lowest-cost current vision model ($0.10 per million input tokens, $0.50 per million output tokens, November 2026), called through the Responses API with a strict JSON schema. Override it with the `DESCRIBE_MODEL` Convex environment variable. `OPENAI_API_KEY` exists only in the Convex deployment's environment.
- Source of truth: the app sends only the post URI, the detail level and a device id. The action fetches the post itself from Bluesky's public AppView (`app.bsky.feed.getPosts` on `public.api.bsky.app`) and builds the model input only from that response, mapped with the same `mapFeedItem` and `descriptionInput` the app uses. A URI that does not resolve to a post, or a post with nothing to describe, returns null with no model call and is remembered as a failed row for ten minutes, so asking again does not fetch it again. Only `did:plc` post URIs are accepted, and a caption fetch goes only to a PDS with a public https host name, so the deployment never fetches a URL a caller chose.
- Fetch limits, taken before anything is fetched from Bluesky and after the cache is checked: 600 fetches per device, 1,200 per caller address and 6,000 for the whole deployment per clock hour (`FETCH_LIMITS` in `convex/describeCache.ts`). The caller address comes from Convex's request metadata, never from the client. A listener needs about one fetch per post with media, so 600 is several hours of brisk scrolling compressed into one; 1,200 per address lets a few phones share a network while stopping one machine from inventing device ids; 6,000 is about 100 a minute, far below the 3,000 requests per five minutes Bluesky's AppView allows one address. Like the spend cap, using up the deployment's fetches turns new descriptions off for everyone until the hour ends; cached descriptions are still served. Only SHA-256 digests of the device id and address are stored.
- Cache: `postDescriptions` rows keyed by post URI, prompt version, detail level and the listener's languages (`en>en,hi`: the target, then the languages read as written; empty when translation is off). Bumping `PROMPT_VERSION` in `convex/describePrompt.ts` re-describes posts under the new rules. Translation moved it from 5 to 6, so after that deploy every post is described once more, at the cost of a fresh post (see the PR for #16 for the estimate).
- Dedupe: a Convex mutation claims the key in a transaction before calling the model. A concurrent request for the same key sees the pending row and waits for its result (measured: six concurrent calls, one model call). The app also shares one in-flight request per post.
- No call at all for a post with no images, no video and no more than three tags in a pile, unless its text is in a language the listener does not read.
- Spend cap: at most $2 of model spend per clock hour across the deployment, counted from the cost each response reports. The counter lives in one `describeUsage` row per hour. Each claim reserves $0.01 in the same transaction that claims the post, and completion replaces the reservation with the recorded cost, so calls in flight already count. A failed or timed-out model call gives its reservation back, and a claim whose action never reports back is failed and its reservation given back after 90 seconds by a scheduled `expire`. One call cannot cost more than its reservation:
  - input: at most 10 images × about 3,200 tokens (the largest per-image count seen in evaluation), plus about 2,000 tokens of instructions and post text, is 34,000 tokens × $0.10 per million = $0.0034;
  - output: capped at 4,000 tokens × $0.50 per million = $0.002;
  - total: $0.0054, under the $0.01 reserved.

  So the true worst case is $2.00 an hour ($48 a day), whatever device ids or URIs a caller sends, because every call must be a real post and is described once per detail level. At the measured average of $0.00047 a described post, $2 covers about 4,000 described posts an hour. Reaching the cap turns descriptions off for every listener until the hour ends, which is the price of a hard bound.
- Per-device limit: 240 model calls per device per clock hour. A brisk listener at six posts a minute with half carrying media needs about 180. The device id is random and chosen by the app, so this only keeps one honest client from using up the shared budget; the spend cap is the bound. The database stores only a SHA-256 digest of the id, in that hour's counter row, and counter rows from past hours, and failed rows older than an hour, are deleted as new requests arrive. Description rows hold no device information.
- Text in images: the model also lists every piece of visible text in each image (`visible_text`). For an image with author alt text, only the alt text and the model's addition are spoken, so the server appends any listed text that neither already contains ("Text in the image reads “© PONZINI PHOTOGRAPHY”.").
- Names: the model uses a person's name only when the post text or alt text says that person is pictured, always credited to the post ("whom the post names as …"). It records that decision first in a `names_shown` field the app never reads, which made a small model follow the rule reliably.
- As a second check, only images on `cdn.bsky.app` and video thumbnails on `video.bsky.app` under the post author's DID are sent to the model.
- Prompt caching is explicit and limited to the shared instructions, so per-post images are never billed at the cache-write rate.
- Video: the model sees the thumbnail (usually the opening frame), alt text and, when the record has captions, the start of the WebVTT captions fetched from the author's PDS. Descriptions start with "Opens on" and never claim the video was watched.

## Known limits

- Descriptions are keyed by post URI, not by the post's content (its CID). Bluesky's app never edits a post, but any client can rewrite a record in place at the same URI. A post rewritten that way keeps the description of its earlier images until `PROMPT_VERSION` is bumped or the row is deleted. We accept that staleness: in-place rewrites are rare, and keying by CID would mean trusting a CID sent by the client or fetching the post on every cache hit.
- Translation decides on a post's language by script and common words; a short or mostly-mixed post, or a Latin-script language outside the ten it counts, is read as written unless the post declares a language the listener does not read. Comment replies (the comments view, #7) are not translated yet.
- Using up the deployment's hourly spend or fetch allowance turns new descriptions off for every listener until the hour ends (see above). Cached descriptions are still served.

## Earcons

A short, quiet sound plays before a post's narration: `image` one high bell note (160 ms), `video` two rising notes (220 ms), `repost` two low blips (185 ms), `reply` one falling glide (220 ms). One per post, most informative first: video, image, reply, repost. Speech starts as the sound ends. The sounds are synthesized by `scripts/generate-earcons.py` and committed in `assets/sounds`. The audio session is set to play in silent mode and mix with other audio.
