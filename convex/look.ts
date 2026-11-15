import { v } from 'convex/values';

import { internal } from './_generated/api';
import { action, type ActionCtx } from './_generated/server';
import { isDeviceId } from './describeCache';
import { env } from './describeOpenAI';
import { decideProblem, imageProblem, lookChecks, lookHash, lookSpends, reservationUsd, type LookAction } from './lookLimits';
import { DEFAULT_DECISION_MODEL, DEFAULT_LOOK_MODEL, decideWithOpenAI, describeImageWithOpenAI } from './lookOpenAI';
import type { Edge } from './lookPrompt';

// The camera and photo library (docs/camera.md). Images are base64 JPEGs downscaled on the phone. They are
// sent to OpenAI and nowhere else: never written to the database and never logged. Logs carry only the action,
// latency, model, cost and an error class, never a description, a subject or any text from a picture.

type Failure = { ok: false; reason: 'invalid' | 'limited' | 'budget' | 'unavailable' | 'failed' };
export type DescribeImageResult =
  | { ok: true; description: string; altText: string; visibleText: string[]; latencyMs: number; costUsd: number | null; model: string }
  | Failure;
export type DecideResult =
  | { ok: true; inView: number | null; cutOff: Edge | null; tooDark: number | null; tooBlurry: number | null; latencyMs: number; costUsd: number | null; model: string }
  | Failure;

// Limits are taken before any outbound call: every call-count window and the spend reservations (the
// deployment's and the caller address's), in one transaction, or none of them. Known limit, as in describe.ts:
// a request whose metadata has no ip gets only the device and deployment limits.
async function reserve(ctx: ActionCtx, action: LookAction, deviceId: string, reserveUsd: number) {
  const { ip } = await ctx.meta.getRequestMetadata();
  const address = ip ? await lookHash('address', ip) : null;
  return ctx.runMutation(internal.lookUsage.reserve, { checks: lookChecks(action, await lookHash('device', deviceId), address), spends: lookSpends(address), reserveUsd });
}

export const describeImage = action({
  args: { image: v.string(), deviceId: v.string(), purpose: v.union(v.literal('view'), v.literal('photo'), v.literal('library')) },
  handler: async (ctx, { image, deviceId, purpose }): Promise<DescribeImageResult> => {
    if (!isDeviceId(deviceId) || imageProblem(image, 'describe')) return { ok: false, reason: 'invalid' };
    const apiKey = env('OPENAI_API_KEY');
    const model = env('LOOK_MODEL') || DEFAULT_LOOK_MODEL;
    const reserveUsd = reservationUsd(model, 'describe');
    if (!apiKey || reserveUsd === null) {
      console.warn(`look.describeImage unavailable: ${apiKey ? `model ${model} has no price` : 'OPENAI_API_KEY is not set'}`);
      return { ok: false, reason: 'unavailable' };
    }
    const reserved = await reserve(ctx, 'describe', deviceId, reserveUsd);
    if (!reserved.ok) {
      console.warn(`look.describeImage refused: ${reserved.refused}`);
      return { ok: false, reason: reserved.refused };
    }
    const started = Date.now();
    const result = await describeImageWithOpenAI({ apiKey, model, image, purpose });
    const latencyMs = Date.now() - started;
    await ctx.runMutation(internal.lookUsage.settle, { windowStart: reserved.windowStart, spendKeys: reserved.spendKeys, reserveUsd, costUsd: result.usage?.costUsd ?? null });
    if (!result.ok) {
      console.error(`look.describeImage failed (${result.error}) after ${latencyMs} ms with ${model}, cost ${result.usage?.costUsd ?? 'none'} USD`);
      return { ok: false, reason: 'failed' };
    }
    console.log(`look.describeImage ${purpose} in ${latencyMs} ms with ${result.model}, cost ${result.usage.costUsd ?? 'unknown'} USD`);
    return { ok: true, description: result.description, altText: result.altText, visibleText: result.visibleText, latencyMs, costUsd: result.usage.costUsd, model: result.model };
  },
});

export const decide = action({
  args: {
    image: v.string(),
    deviceId: v.string(),
    subject: v.union(v.string(), v.null()),
    checks: v.array(v.union(v.literal('inView'), v.literal('cutOff'), v.literal('quality'))),
  },
  handler: async (ctx, { image, deviceId, subject, checks }): Promise<DecideResult> => {
    if (!isDeviceId(deviceId) || decideProblem(subject, checks) || imageProblem(image, 'decide')) return { ok: false, reason: 'invalid' };
    const apiKey = env('OPENAI_API_KEY');
    const model = env('LOOK_DECISION_MODEL') || DEFAULT_DECISION_MODEL;
    const reserveUsd = reservationUsd(model, 'decide');
    if (!apiKey || reserveUsd === null) {
      console.warn(`look.decide unavailable: ${apiKey ? `model ${model} has no price` : 'OPENAI_API_KEY is not set'}`);
      return { ok: false, reason: 'unavailable' };
    }
    const reserved = await reserve(ctx, 'decide', deviceId, reserveUsd);
    if (!reserved.ok) {
      console.warn(`look.decide refused: ${reserved.refused}`);
      return { ok: false, reason: reserved.refused };
    }
    const started = Date.now();
    const result = await decideWithOpenAI({ apiKey, model, image, subject, checks });
    const latencyMs = Date.now() - started;
    await ctx.runMutation(internal.lookUsage.settle, { windowStart: reserved.windowStart, spendKeys: reserved.spendKeys, reserveUsd, costUsd: result.usage?.costUsd ?? null });
    if (!result.ok) {
      console.error(`look.decide failed (${result.error}) after ${latencyMs} ms with ${model}, cost ${result.usage?.costUsd ?? 'none'} USD`);
      return { ok: false, reason: 'failed' };
    }
    console.log(`look.decide in ${latencyMs} ms with ${result.model}, cost ${result.usage.costUsd ?? 'unknown'} USD`);
    return { ok: true, ...result.answers, latencyMs, costUsd: result.usage.costUsd, model: result.model };
  },
});
