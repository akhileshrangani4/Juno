import { v } from 'convex/values';

import { memoryRejection, type Memory } from '../src/agent/memoryClient';
import { callerChecks, deviceCheck, MAX_FACTS } from '../src/agent/memoryRateLimits';
import { internal } from './_generated/api';
import { action, type ActionCtx } from './_generated/server';

// Per-user memory in Supermemory. Each fact the user states is one document, so recall returns exactly what
// they said, at once, and deleting the document also forgets the memories Supermemory derived from it.
// SUPERMEMORY_API_KEY is set only in this deployment's environment.

const API = 'https://api.supermemory.ai';
const SOURCE = 'user_stated';
const TOO_MANY = 'Too many memory requests. Try again in a few minutes.';

const identity = { userKey: v.string(), secret: v.string() };

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The namespace is a hash, so Supermemory never sees the user's DID or device id.
async function namespaceFor(ctx: ActionCtx, userKey: string, secret: string): Promise<string> {
  if (userKey.length > 200 || secret.length < 16 || secret.length > 200) throw new Error('Invalid memory identity');
  const { ip } = await ctx.meta.getRequestMetadata();
  const callerAllowed = await ctx.runMutation(internal.memoryLimits.take, { checks: callerChecks(ip ? await sha256(`address:${ip}`) : null) });
  if (!callerAllowed) throw new Error(TOO_MANY);
  const allowed = await ctx.runMutation(internal.memoryOwners.verify, { userKey, secretHash: await sha256(secret) });
  if (!allowed) throw new Error('This memory belongs to another device');
  if (!(await ctx.runMutation(internal.memoryLimits.take, { checks: deviceCheck(userKey) }))) throw new Error(TOO_MANY);
  return `consumerhack_${(await sha256(`memory:${userKey}`)).slice(0, 40)}`;
}

async function supermemory<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error('Memory is not configured');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supermemory ${method} ${path.replace(/\/ns\/[^/]+/, '/ns/…')} failed with ${response.status}`);
  return (await response.json()) as T;
}

type Document = { id: string; content?: string | null; title?: string | null; metadata?: { source?: string; text?: string } };

async function listFacts(namespace: string): Promise<Memory[]> {
  const { documents } = await supermemory<{ documents: Document[] }>('POST', `/ns/${namespace}/list/documents?limit=50`, { include: { content: true } });
  return documents
    .filter((document) => document.metadata?.source === SOURCE)
    .map((document) => ({ id: document.id, text: document.metadata?.text ?? document.content ?? '' }))
    .filter((memory) => memory.text);
}

export const remember = action({
  args: { ...identity, fact: v.string() },
  handler: async (ctx, { userKey, secret, fact }): Promise<Memory> => {
    const text = fact.trim();
    const rejected = memoryRejection(text, null);
    if (rejected) throw new Error(`Not stored: ${rejected}`);
    const namespace = await namespaceFor(ctx, userKey, secret);
    if ((await listFacts(namespace)).length >= MAX_FACTS) throw new Error(`Not stored: memory is full (${MAX_FACTS} facts). Forget something first.`);
    const id = `fact_${crypto.randomUUID().replace(/-/g, '')}`;
    await supermemory('POST', `/ns/${namespace}/document`, { id, content: text, metadata: { source: SOURCE, text }, dreaming: 'instant' });
    return { id, text };
  },
});

export const list = action({
  args: identity,
  handler: async (ctx, { userKey, secret }): Promise<Memory[]> => listFacts(await namespaceFor(ctx, userKey, secret)),
});

export const forget = action({
  args: { ...identity, ids: v.array(v.string()) },
  handler: async (ctx, { userKey, secret, ids }): Promise<Memory[]> => {
    const namespace = await namespaceFor(ctx, userKey, secret);
    const known = (await listFacts(namespace)).filter((memory) => ids.includes(memory.id));
    if (!known.length) return [];
    // A fact stored seconds ago can still be processing, and Supermemory refuses to delete it until it is done.
    for (let attempt = 0; attempt < 8; attempt++) {
      const { errors } = await supermemory<{ errors: { id: string; error: string }[] }>('DELETE', `/ns/${namespace}/document`, { ids: known.map((memory) => memory.id) });
      if (!errors.some((error) => /processing/i.test(error.error))) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const left = new Set((await listFacts(namespace)).map((memory) => memory.id));
    return known.filter((memory) => !left.has(memory.id));
  },
});
