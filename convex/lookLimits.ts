import { takeOne, type Bucket, type RateCheck } from '../src/agent/memoryRateLimits';
import { costUsd } from './describeCache';

// Limits on the public camera actions in convex/look.ts (describeImage and decide). Pure logic with no
// Convex imports, so every number and every transaction rule here is unit tested. docs/camera.md explains
// the same numbers for people.

export type LookAction = 'describe' | 'decide';
export type Check = 'inView' | 'cutOff' | 'quality';
export type Refusal = 'limited' | 'budget';

const TEN_MINUTES = 10 * 60_000;
const HOUR = 60 * 60_000;

// Call-count windows, one set per action, taken in the same transaction as the spend reservation:
// - per device (a hash of the app's device id). describe: the camera describes what it sees at most once
//   every 8 seconds while it is open (75 per 10 minutes), plus descriptions the user asks for and the library
//   walk (one per photo reached plus two prefetched). 120 per 10 minutes covers all of it at a steady pace,
//   and a client stuck in a loop stops within minutes. decide: about one check a second, only while the user
//   has asked a question (the app stops each question after 45 seconds), plus one before each shutter press.
//   300 per 10 minutes is five minutes of continuous questions in every ten.
// - per caller address (the request's IP, stored only as a hash): twice the device numbers, so two people
//   behind one home router both get a full allowance, while inventing new device ids from one place gets
//   no further than two devices' worth. These windows alone do not stop one address from using up the
//   hourly budget: priced at the reservations below, 240 describes and 600 decides per 10 minutes are
//   $0.336 per window, or up to $2 an hour. Sizing them to a third of the budget would leave one person
//   describing every 8 seconds ($0.35 an hour of reservations) no room at all, so one address's spend is
//   capped separately (LOOK_ADDRESS_BUDGET_USD_PER_HOUR).
// - for the whole deployment: a ceiling on calls whatever addresses are used (describe 3,000 an hour is
//   25 devices at their full describe rate; decide 10,000 an hour is about 33 people asking without pause).
//   It also bounds what can be spent on calls the spend cap never hears about (see docs/camera.md).
export const LOOK_LIMITS = {
  describe: {
    device: { limit: 120, windowMs: TEN_MINUTES },
    address: { limit: 240, windowMs: TEN_MINUTES },
    deployment: { limit: 3_000, windowMs: HOUR },
  },
  decide: {
    device: { limit: 300, windowMs: TEN_MINUTES },
    address: { limit: 600, windowMs: TEN_MINUTES },
    deployment: { limit: 10_000, windowMs: HOUR },
  },
} as const;

// One hourly model budget for both actions together, counted from the cost each response reports, in the
// "look:global" row of describeUsage (describe.ts keeps its own $2 budget in the "global" row). A described
// frame costs about $0.00019 and a decision check about $0.00011 (measured with pnpm eval:look), so one person
// at every device limit without pause spends about $0.34 an hour, and ordinary use far less. $1 an hour serves
// several people at once and bounds the recorded spend at $24 a day.
// Reaching it turns the camera's descriptions and checks off for everyone until the clock hour ends.
export const LOOK_BUDGET_USD_PER_HOUR = 1;

// One caller address may spend at most a third of that hourly budget, kept like the budget itself: in a
// describeUsage row keyed "look:address:<digest>" for the clock hour, reserved in the same transaction and
// settled to the reported cost. So one address can never turn the camera off for everyone; it takes at least
// three. Ordinary use by one person (a description every 8 seconds while the camera is open, about $0.09 an
// hour at the measured cost, plus a check a second while asking, about $0.05 an hour for ten 45-second
// questions) is under half of it, so two people behind one router both fit. One person at every device limit
// without pause ($0.34 an hour) reaches it only in the hour's last minute or two. A request with no address
// (getRequestMetadata gives no ip) has no address cap, as in describe.ts: only the device windows, the
// deployment windows and the hourly budget apply.
export const LOOK_ADDRESS_BUDGET_USD_PER_HOUR = LOOK_BUDGET_USD_PER_HOUR / 3;

// Images arrive downscaled by the phone: describe frames with a long side of at most 768 pixels, decide frames
// at most 512. The byte caps are generous for JPEGs of those sizes and are checked on the base64 string before
// it is decoded. The pixel caps bound the image tokens the model can bill, which the reservations rely on.
export const IMAGE_LIMITS = {
  describe: { maxBytes: 300 * 1024, maxSide: 768 },
  decide: { maxBytes: 120 * 1024, maxSide: 512 },
} as const;

export const MAX_SUBJECT = 80;
export const DESCRIBE_MAX_OUTPUT_TOKENS = 800;

// The most a single call can bill, in tokens. Image tokens grow with the pixel area: measured on gpt-6-luna,
// a whole request with the largest frame describe accepts (768 x 768) is 1,714 input tokens, and with the
// largest decide accepts (512 x 512), all four questions and an 80-character subject, 1,253; detail "low" never
// bills more image tokens than that. A unit test keeps the text around the image within the length it had when
// measured. Reserved here as 3,000 and 2,000. Output is capped by max_output_tokens for describe (the longest
// seen was 149); the Decisions API bills no output tokens.
export const WORST_CASE_TOKENS = {
  describe: { inputTokens: 3_000, outputTokens: DESCRIBE_MAX_OUTPUT_TOKENS },
  decide: { inputTokens: 2_000, outputTokens: 0 },
} as const;

// The reservation is the worst case priced at the model's own rates, taking every input token at whichever
// is dearer of the uncached and the cache-write rate. An unpriced model gets null, and the action refuses it
// rather than call a model whose cost it cannot bound.
export function reservationUsd(model: string, action: LookAction): number | null {
  const { inputTokens, outputTokens } = WORST_CASE_TOKENS[action];
  const uncached = costUsd(model, { inputTokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens });
  const written = costUsd(model, { inputTokens, cachedTokens: 0, cacheWriteTokens: inputTokens, outputTokens });
  if (uncached === null || written === null) return null;
  return Math.max(uncached, written);
}

// The raw device id and address never reach the database: only these digests key the counters.
export async function lookHash(kind: 'device' | 'address', value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`look-${kind}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function lookChecks(action: LookAction, deviceHash: string, addressHash: string | null): RateCheck[] {
  const limits = LOOK_LIMITS[action];
  return [
    { key: `look:${action}:device:${deviceHash}`, ...limits.device },
    ...(addressHash ? [{ key: `look:${action}:address:${addressHash}`, ...limits.address }] : []),
    { key: `look:${action}:deployment`, ...limits.deployment },
  ];
}

// The hourly spend counters a call reserves against, as describeUsage keys: the whole deployment's, and the
// caller address's when the request has one.
export type SpendCheck = { key: string; limitUsd: number };

export function lookSpends(addressHash: string | null): SpendCheck[] {
  return [
    { key: 'look:global', limitUsd: LOOK_BUDGET_USD_PER_HOUR },
    ...(addressHash ? [{ key: `look:address:${addressHash}`, limitUsd: LOOK_ADDRESS_BUDGET_USD_PER_HOUR }] : []),
  ];
}

export type ReservePlan = { refused: Refusal } | { refused: null; buckets: Bucket[]; spentUsd: number[] };

// What the reserve mutation does in one transaction: take one call from every window and add the reservation
// to every spend counter, or change nothing when any window is used up or the reservation would pass any
// spend limit. The reservation of this call counts, so concurrent calls can never together overshoot.
export function planReserve(rows: (Bucket | null)[], checks: RateCheck[], spends: SpendCheck[], spentUsd: number[], reserveUsd: number, now: number): ReservePlan {
  const buckets: Bucket[] = [];
  for (const [i, check] of checks.entries()) {
    const next = takeOne(rows[i] ?? null, check, now);
    if (!next) return { refused: 'limited' };
    buckets.push(next);
  }
  if (spends.some((spend, i) => (spentUsd[i] ?? 0) + reserveUsd > spend.limitUsd)) return { refused: 'budget' };
  return { refused: null, buckets, spentUsd: spends.map((_, i) => (spentUsd[i] ?? 0) + reserveUsd) };
}

// After the call the reservation is swapped for what the response reported, or released entirely when there
// is no usage to report (a failed request, or one this deployment timed out). Never below zero.
export function settledSpend(spentUsd: number, reserveUsd: number, costUsd: number | null): number {
  return Math.max(0, spentUsd - reserveUsd + (costUsd ?? 0));
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// Width and height from a JPEG's frame header (bytes as a binary string, as atob returns them), or null when
// the bytes do not start like a JPEG or have no frame header before the image data.
export function jpegSize(bytes: string): { width: number; height: number } | null {
  const at = (i: number) => bytes.charCodeAt(i);
  if (at(0) !== 0xff || at(1) !== 0xd8 || at(2) !== 0xff) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (at(i) !== 0xff) return null;
    const marker = at(i + 1);
    if (marker === 0xff) i += 1;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) i += 2;
    else if (marker === 0xd9 || marker === 0xda) return null;
    else if (START_OF_FRAME.has(marker)) return i + 8 < bytes.length ? { height: (at(i + 5) << 8) | at(i + 6), width: (at(i + 7) << 8) | at(i + 8) } : null;
    else i += 2 + ((at(i + 2) << 8) | at(i + 3));
  }
  return null;
}

// Why an image argument is refused, or null when it is a base64 JPEG (no "data:" prefix) within the action's
// byte and pixel caps. The length is checked before anything is decoded.
export function imageProblem(image: string, action: LookAction): string | null {
  const { maxBytes, maxSide } = IMAGE_LIMITS[action];
  if (image.length > Math.ceil(maxBytes / 3) * 4) return 'image is too large';
  if (image.length === 0 || image.length % 4 !== 0 || !BASE64.test(image)) return 'image is not base64';
  const bytes = atob(image);
  if (bytes.length > maxBytes) return 'image is too large';
  const size = jpegSize(bytes);
  if (!size) return 'image is not a JPEG';
  if (size.width < 1 || size.height < 1) return 'image has no pixels';
  if (Math.max(size.width, size.height) > maxSide) return 'image has too many pixels';
  return null;
}

// The subject is inserted into the questions inside quotation marks, so quotation marks and control
// characters in it become spaces and it can never close the quote.
export const cleanSubject = (subject: string) =>
  subject
    .replace(/[\u0000-\u001f\u007f"\u201c\u201d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Why a decide request is refused, or null. inView and cutOff need a subject; quality alone does not.
export function decideProblem(subject: string | null, checks: Check[]): string | null {
  if (checks.length === 0) return 'no checks';
  if (new Set(checks).size !== checks.length) return 'duplicate checks';
  if (subject === null) return checks.some((check) => check !== 'quality') ? 'checks need a subject' : null;
  const cleaned = cleanSubject(subject);
  if (!cleaned) return 'subject is empty';
  if (cleaned.length > MAX_SUBJECT) return 'subject is too long';
  return null;
}
