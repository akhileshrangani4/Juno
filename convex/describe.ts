import { v } from 'convex/values';

import { internal } from './_generated/api';
import { action } from './_generated/server';
import { decideClaim, hashAddress, hashDevice, invalidReason, isDeviceId, isPostUri, LIMITS, needsModel, normalizeParts, postDid, type Parts } from './describeCache';
import { fetchCaptions } from './describeCaptions';
import { DEFAULT_MODEL, describeWithOpenAI, env } from './describeOpenAI';
import { PROMPT_VERSION, systemPrompt, userContent } from './describePrompt';
import { fetchPost } from './describeSource';
import { detailValidator } from './schema';

type Source = 'cache' | 'model' | 'shared';

// Describes a post's images, video and hashtag pile. The client names the post and nothing more; the post
// itself is fetched from Bluesky here, and only after the fetch limits allow it. Returns null whenever there is
// nothing to describe or anything goes wrong; the app then keeps its deterministic narration and never tells
// the listener about the failure.
export const describePost = action({
  args: { uri: v.string(), detail: detailValidator, deviceId: v.string() },
  handler: async (ctx, { uri, detail, deviceId }): Promise<{ parts: Parts; source: Source } | null> => {
    if (!isPostUri(uri) || !isDeviceId(deviceId)) return null;
    const key = { postUri: uri, promptVersion: PROMPT_VERSION, detail };

    const waitForShared = async () => {
      const deadline = Date.now() + LIMITS.sharedWaitMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LIMITS.sharedPollMs));
        const row = await ctx.runQuery(internal.postDescriptions.get, key);
        if (row?.status === 'done' && row.parts) return { parts: row.parts, source: 'shared' as const };
        if (!row || row.status === 'failed') return null;
      }
      return null;
    };

    // Served or settled from the cache before anything is fetched: a description, one being written right
    // now, or a recent miss or failure.
    const known = decideClaim(await ctx.runQuery(internal.postDescriptions.get, key), Date.now());
    if (known.kind === 'cached') return { parts: known.parts, source: 'cache' };
    if (known.kind === 'failedRecently') return null;
    if (known.kind === 'inflight') return waitForShared();

    const deviceHash = await hashDevice(deviceId);
    const { ip } = await ctx.meta.getRequestMetadata();
    if (!(await ctx.runMutation(internal.postDescriptions.admit, { deviceHash, addressHash: ip ? await hashAddress(ip) : null }))) {
      console.warn('describePost fetch limit reached');
      return null;
    }

    const post = await fetchPost(uri);
    const reason = !post ? 'post not found' : !needsModel(post) ? 'nothing to describe' : invalidReason(post);
    if (!post || reason) {
      if (reason !== 'nothing to describe') console.warn(`describePost skipped ${uri}: ${reason}`);
      await ctx.runMutation(internal.postDescriptions.miss, { ...key, reason: reason ?? 'post not found' });
      return null;
    }
    const decision = await ctx.runMutation(internal.postDescriptions.claim, { ...key, deviceHash });
    switch (decision.kind) {
      case 'cached':
        return { parts: decision.parts, source: 'cache' };
      case 'limited':
        console.warn('describePost spend limit reached');
        return null;
      case 'failedRecently':
        return null;
      case 'inflight':
        return waitForShared();
      case 'claim':
        break;
    }

    const started = Date.now();
    try {
      const apiKey = env('OPENAI_API_KEY');
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set in the Convex deployment');
      const captions = post.video ? await fetchCaptions(postDid(uri) ?? '', post.video.captions) : null;
      const result = await describeWithOpenAI({
        apiKey,
        model: env('DESCRIBE_MODEL') || DEFAULT_MODEL,
        instructions: systemPrompt(detail),
        content: userContent(post, captions),
      });
      const parts = normalizeParts(result.parsed, post);
      const latencyMs = Date.now() - started;
      await ctx.runMutation(internal.postDescriptions.complete, { ...key, windowStart: decision.windowStart, parts, model: result.model, latencyMs, usage: result.usage });
      console.log(`described ${uri} in ${latencyMs} ms with ${result.model}, cost ${result.usage.costUsd ?? 'unknown'} USD`);
      return { parts, source: 'model' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`describePost failed for ${uri}: ${message}; reservation released`);
      await ctx.runMutation(internal.postDescriptions.fail, { ...key, error: message });
      return null;
    }
  },
});
