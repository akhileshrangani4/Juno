import type { DescriptionInput } from '../src/narration/buildNarration';

export type PostInput = DescriptionInput;
export type Parts = { images: { description: string; beyondAlt: string }[]; video: string | null; hashtagTopic: string | null };
export type Usage = { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number; costUsd: number | null };

// Spend is bounded by an hourly budget counted from recorded cost, not from call counts. Every claim
// reserves reserveUsd before the model is called, and completion swaps the reservation for the cost the
// response actually reported, so calls in flight already count against the budget. A single call cannot
// cost more than its reservation: at most 10 images of about 3,200 input tokens each (the largest seen
// in evaluation), plus about 2,000 tokens of instructions and post text, is 34,000 input tokens, or
// $0.0034 at $0.10 per million; output is capped at 4,000 tokens, or $0.002 at $0.50 per million; so
// $0.0054 at most, under the $0.01 reserved. The worst case is therefore hourlyBudgetUsd, $2 an hour
// ($48 a day), whatever device ids a caller invents. Reaching it turns descriptions off for every
// listener until the hour ends, which is the price of a hard bound; the per-device limit stops one honest
// client from getting there. A brisk listener needs about 180 described posts an hour (6 posts a minute,
// half with media), at about $0.0005 each, so $2 covers roughly 4,000 described posts an hour.
export const LIMITS = {
  windowMs: 60 * 60 * 1000,
  perDevice: 240,
  hourlyBudgetUsd: 2,
  reserveUsd: 0.01,
  pruneBatch: 20,
  pendingStaleMs: 45 * 1000,
  failureRetryMs: 10 * 60 * 1000,
  sharedWaitMs: 30 * 1000,
  sharedPollMs: 400,
};

const TOPIC_THRESHOLD = 3;
const MAX_IMAGES = 10;
const MAX_TEXT = 3000;
const MAX_PART = 1500;

export type Row = { status: 'pending' | 'done' | 'failed'; updatedAt: number; parts?: Parts | null };
export type ClaimDecision = { kind: 'cached'; parts: Parts } | { kind: 'inflight' } | { kind: 'failedRecently' } | { kind: 'claim' };
export type UsageWindow = { calls: number; costUsd: number };

export function decideClaim(row: Row | null, now: number): ClaimDecision {
  if (!row) return { kind: 'claim' };
  if (row.status === 'done' && row.parts) return { kind: 'cached', parts: row.parts };
  if (row.status === 'pending' && now - row.updatedAt < LIMITS.pendingStaleMs) return { kind: 'inflight' };
  if (row.status === 'failed' && now - row.updatedAt < LIMITS.failureRetryMs) return { kind: 'failedRecently' };
  return { kind: 'claim' };
}

export const windowStart = (now: number) => now - (now % LIMITS.windowMs);

export const withinLimits = (device: UsageWindow | null, global: UsageWindow | null) =>
  (device?.calls ?? 0) < LIMITS.perDevice && (global?.costUsd ?? 0) + LIMITS.reserveUsd <= LIMITS.hourlyBudgetUsd;

// The raw device id never reaches the database: only this digest keys the hourly counter, and counter rows
// are deleted once their hour has passed.
export async function hashDevice(deviceId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`describe-device:${deviceId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function needsModel(post: PostInput): boolean {
  return post.images.length > 0 || post.video !== null || post.hashtags.length > TOPIC_THRESHOLD;
}

// did:plc only: a did:web names a host the caller controls, and resolving it would make this deployment
// fetch arbitrary URLs.
const POST_URI = /^at:\/\/(did:plc:[a-z2-7]{24})\/app\.bsky\.feed\.post\/[A-Za-z0-9._~-]{1,64}$/;
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

export const isPostUri = (uri: string) => POST_URI.test(uri);
export const isDeviceId = (deviceId: string) => DEVICE_ID.test(deviceId);

function hostedBy(url: string | null, host: string, did: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === host && decodeURIComponent(parsed.pathname).includes(`/${did}/`);
  } catch {
    return false;
  }
}

// The post comes from Bluesky's AppView, so these checks are a second line: only Bluesky's own CDNs, and
// only media under the post author's DID, are ever sent to the model.
export function invalidReason(post: PostInput): string | null {
  const did = POST_URI.exec(post.uri)?.[1];
  if (!did) return 'post uri is not a Bluesky post';
  if (post.text.length > MAX_TEXT || post.authorName.length > 200) return 'post text is too long';
  if (post.images.length > MAX_IMAGES) return 'too many images';
  if (!post.images.every((image) => hostedBy(image.url, 'cdn.bsky.app', did))) return 'image is not on the Bluesky CDN';
  if (post.video && !hostedBy(post.video.thumbUrl, 'video.bsky.app', did)) return 'video thumbnail is not on the Bluesky CDN';
  if (post.hashtags.length > 100 || post.hashtags.some((tag) => tag.length > 100)) return 'too many hashtags';
  return null;
}

export const postDid = (uri: string) => POST_URI.exec(uri)?.[1] ?? null;

const clip = (value: unknown, max = MAX_PART) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? text.slice(0, text.lastIndexOf(' ', max)) : text;
};

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Text in a picture must reach the listener. When the author wrote alt text, only the alt text and
// beyond_alt are spoken, so any visible text that neither contains is added to beyond_alt here.
function beyondAlt(alt: string, entry: Record<string, unknown>): string {
  const extra = clip(entry.beyond_alt);
  const covered = comparable(`${alt} ${extra}`);
  const missing = (Array.isArray(entry.visible_text) ? entry.visible_text : [])
    .map((text) => clip(text, 300))
    .filter((text) => comparable(text) && !covered.includes(comparable(text)));
  const reads = missing.length ? `Text in the image reads ${missing.map((text) => `“${text}”`).join(', ')}.` : '';
  return clip([extra, reads].filter(Boolean).join(' '));
}

export function normalizeParts(raw: unknown, post: PostInput): Parts {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const images = Array.isArray(value.images) ? value.images : [];
  return {
    images: post.images.map((image, i) => {
      const entry = (typeof images[i] === 'object' && images[i] !== null ? images[i] : {}) as Record<string, unknown>;
      return { description: clip(entry.description), beyondAlt: image.alt ? beyondAlt(image.alt, entry) : '' };
    }),
    video: post.video ? clip(value.video) || null : null,
    hashtagTopic: post.hashtags.length > TOPIC_THRESHOLD ? clip(value.hashtag_topic, 80) || null : null,
  };
}

// USD per million tokens, from OpenAI's pricing page (November 2026). Unknown models record no cost.
const PRICES: Record<string, { input: number; cached: number; cacheWrite: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, cacheWrite: 1.25, output: 5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, cacheWrite: 0.2, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, cacheWrite: 0.75, output: 4.5 },
};

export function costUsd(model: string, usage: Omit<Usage, 'costUsd'>): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  const total = uncached * price.input + usage.cachedTokens * price.cached + usage.cacheWriteTokens * price.cacheWrite + usage.outputTokens * price.output;
  return total / 1_000_000;
}
