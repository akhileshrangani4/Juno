import { costUsd, type Usage } from './describeCache';
import { RESPONSE_SCHEMA } from './describePrompt';

// gpt-6-luna is OpenAI's lowest-cost current model with image input ($0.10 / $0.50 per million tokens,
// November 2026). Override with the DESCRIBE_MODEL environment variable in the Convex deployment.
export const DEFAULT_MODEL = 'gpt-6-luna';
// Prompt caching is explicit and covers only the shared instructions. The default implicit breakpoint
// would cache each post's images too, billing them at the 1.25x cache-write rate although no other
// request ever reuses them.
const TIMEOUT_MS = 30_000;

export const env = (name: string): string | undefined => (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env[name];

type Result = { parsed: unknown; usage: Usage; model: string };

export async function describeWithOpenAI({ apiKey, model, instructions, content }: { apiKey: string; model: string; instructions: string; content: unknown[] }): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: instructions, prompt_cache_breakpoint: { mode: 'explicit' } }] },
          { role: 'user', content },
        ],
        prompt_cache_options: { mode: 'explicit' },
        reasoning: { effort: 'low' },
        max_output_tokens: 4000,
        store: false,
        text: { format: { type: 'json_schema', name: 'post_media_description', strict: true, schema: RESPONSE_SCHEMA } },
      }),
    });
    const body = (await response.json()) as Record<string, any>;
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${body?.error?.message ?? 'request failed'}`);
    if (body.status !== 'completed') throw new Error(`OpenAI response ${body.status}: ${body.incomplete_details?.reason ?? 'unknown'}`);
    const message = (body.output as any[]).find((item) => item.type === 'message');
    const part = message?.content?.find((item: any) => item.type === 'output_text' || item.type === 'refusal');
    if (!part || part.type === 'refusal') throw new Error(`OpenAI refused: ${part?.refusal ?? 'no output'}`);
    const details = body.usage?.input_tokens_details ?? {};
    const tokens = {
      inputTokens: body.usage?.input_tokens ?? 0,
      cachedTokens: details.cached_tokens ?? 0,
      cacheWriteTokens: details.cache_write_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
    return { parsed: JSON.parse(part.text), usage: { ...tokens, costUsd: costUsd(model, tokens) }, model: body.model ?? model };
  } finally {
    clearTimeout(timer);
  }
}
