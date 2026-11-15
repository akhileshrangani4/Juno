import { costUsd, type Usage } from './describeCache';
import { DESCRIBE_MAX_OUTPUT_TOKENS, type Check } from './lookLimits';
import { decisionAnswers, decisionInput, decisionQuestions, LOOK_INSTRUCTIONS, LOOK_RESPONSE_SCHEMA, lookText, lookUserContent, type Answers, type LookText, type Purpose } from './lookPrompt';

// gpt-6-luna is OpenAI's lowest-cost current model with image input, and the only model the Decisions API
// accepts. Override with LOOK_MODEL and LOOK_DECISION_MODEL in the Convex deployment; a model missing from the
// price table in describeCache.ts is refused, because its reservation cannot be computed.
export const DEFAULT_LOOK_MODEL = 'gpt-6-luna';
export const DEFAULT_DECISION_MODEL = 'gpt-6-luna';
// For a 384 x 512 frame, detail "low" bills the same tokens as "auto" and answered the same on the test
// frames (docs/camera.md), and it caps the image tokens whatever size arrives.
export const DECISION_DETAIL = 'low';
// The person is waiting with the camera raised; an answer later than this is no longer useful.
const TIMEOUT_MS = 20_000;

// Neither call ever throws, whatever comes back: a failure carries a short error class for the log (never
// content) and any usage the response reported, so the action always settles its reservation and the spend
// counter can record what OpenAI billed. Every field of a response is checked before it is read.
export type Outcome<T> = ({ ok: true; usage: Usage; model: string } & T) | { ok: false; error: string; usage: Usage | null };

type Body = Record<string, unknown>;
const isObject = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

function usageOf(body: Body | null, model: string, billsOutput: boolean): Usage | null {
  const usage = isObject(body?.usage) ? body.usage : null;
  const inputTokens = count(usage?.input_tokens);
  if (!usage || inputTokens === null) return null;
  const details = isObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const tokens = {
    inputTokens,
    cachedTokens: count(details.cached_tokens) ?? 0,
    cacheWriteTokens: count(details.cache_write_tokens) ?? 0,
    outputTokens: billsOutput ? (count(usage.output_tokens) ?? 0) : 0,
  };
  return { ...tokens, costUsd: costUsd(model, tokens) };
}

const modelOf = (body: Body, model: string) => (typeof body.model === 'string' && body.model ? body.model : model);

// The body is null when the response's JSON is not an object (null, a number, an array).
async function post(path: string, apiKey: string, payload: unknown): Promise<{ status: number; body: Body | null } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json();
    return { status: response.status, body: isObject(body) ? body : null };
  } catch (error) {
    return { error: controller.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'unparseable' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function describeImageWithOpenAI({ apiKey, model, image, purpose }: { apiKey: string; model: string; image: string; purpose: Purpose }): Promise<Outcome<LookText>> {
  const reply = await post('responses', apiKey, {
    model,
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: LOOK_INSTRUCTIONS, prompt_cache_breakpoint: { mode: 'explicit' } }] },
      { role: 'user', content: lookUserContent(purpose, image) },
    ],
    prompt_cache_options: { mode: 'explicit' },
    reasoning: { effort: 'none' },
    max_output_tokens: DESCRIBE_MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: 'json_schema', name: 'camera_description', strict: true, schema: LOOK_RESPONSE_SCHEMA } },
  });
  if ('error' in reply) return { ok: false, error: reply.error, usage: null };
  const { status, body } = reply;
  const usage = usageOf(body, model, true);
  if (status !== 200) return { ok: false, error: `http_${status}`, usage };
  if (!body) return { ok: false, error: 'unparseable', usage };
  if (body.status !== 'completed') {
    const reason = isObject(body.incomplete_details) ? body.incomplete_details.reason : null;
    return { ok: false, error: typeof reason === 'string' ? `incomplete_${reason}` : typeof body.status === 'string' ? `incomplete_${body.status}` : 'unparseable', usage };
  }
  const message = (Array.isArray(body.output) ? body.output : []).find((item) => isObject(item) && item.type === 'message');
  const content: unknown[] = Array.isArray(message?.content) ? message.content : [];
  const part = content.find((item): item is Body => isObject(item) && (item.type === 'output_text' || item.type === 'refusal'));
  if (!part || part.type === 'refusal') return { ok: false, error: part ? 'refusal' : 'no_output', usage };
  let text: LookText | null = null;
  try {
    text = typeof part.text === 'string' ? lookText(JSON.parse(part.text), purpose) : null;
  } catch {}
  if (!text || !usage) return { ok: false, error: 'unparseable', usage };
  return { ok: true, ...text, usage, model: modelOf(body, model) };
}

export async function decideWithOpenAI({
  apiKey,
  model,
  image,
  subject,
  checks,
  detail = DECISION_DETAIL,
}: {
  apiKey: string;
  model: string;
  image: string;
  subject: string | null;
  checks: Check[];
  detail?: 'low' | 'auto';
}): Promise<Outcome<{ answers: Answers }>> {
  const reply = await post('decisions', apiKey, {
    model,
    input: decisionInput(image, detail),
    questions: decisionQuestions(subject, checks),
    prompt_cache_options: { mode: 'explicit' },
  });
  if ('error' in reply) return { ok: false, error: reply.error, usage: null };
  const { status, body } = reply;
  const usage = usageOf(body, model, false);
  if (status !== 200) return { ok: false, error: `http_${status}`, usage };
  const answers = body && decisionAnswers(body);
  if (!body || !answers || !usage) return { ok: false, error: 'unparseable', usage };
  return { ok: true, answers, usage, model: modelOf(body, model) };
}
