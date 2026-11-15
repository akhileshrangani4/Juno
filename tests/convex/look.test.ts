import { encode } from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Bucket, RateCheck } from '../../src/agent/memoryRateLimits';
import { costUsd, isDeviceId } from '../../convex/describeCache';
import { systemPrompt } from '../../convex/describePrompt';
import {
  cleanSubject,
  decideProblem,
  imageProblem,
  IMAGE_LIMITS,
  jpegSize,
  LOOK_BUDGET_USD_PER_HOUR,
  LOOK_LIMITS,
  lookChecks,
  lookHash,
  MAX_SUBJECT,
  planReserve,
  reservationUsd,
  settledSpend,
  WORST_CASE_TOKENS,
  type Check,
  type LookAction,
} from '../../convex/lookLimits';
import { decideWithOpenAI, describeImageWithOpenAI } from '../../convex/lookOpenAI';
import { decisionAnswers, decisionInput, decisionQuestions, EDGES, LOOK_INSTRUCTIONS, LOOK_RESPONSE_SCHEMA, lookText, SHARED_RULES } from '../../convex/lookPrompt';

const jpeg = (width: number, height: number) => encode({ width, height, data: Buffer.alloc(width * height * 4, 128) }, 80).data.toString('base64');
const frame = (name: string) => readFileSync(join(__dirname, '../../assets/dev-frames', `${name}.jpg`)).toString('base64');
const PRICED = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-5.4-nano', 'gpt-5.4-mini'];

describe('image validation', () => {
  it('accepts a base64 JPEG within the pixel cap of each action', () => {
    expect(imageProblem(jpeg(576, 768), 'describe')).toBeNull();
    expect(imageProblem(jpeg(768, 768), 'describe')).toBeNull();
    expect(imageProblem(jpeg(384, 512), 'decide')).toBeNull();
    expect(jpegSize(atob(jpeg(384, 512)))).toEqual({ width: 384, height: 512 });
    expect(jpegSize(atob(frame('sign-text')))).toEqual({ width: 768, height: 1024 });
  });

  it('refuses a frame larger than the phone sends, by pixels as well as bytes', () => {
    expect(imageProblem(jpeg(576, 769), 'describe')).toMatch(/pixels/);
    expect(imageProblem(frame('sign-text'), 'describe')).toMatch(/pixels/);
    expect(imageProblem(jpeg(576, 768), 'decide')).toMatch(/pixels/);
    expect(imageProblem('A'.repeat(Math.ceil(IMAGE_LIMITS.describe.maxBytes / 3) * 4 + 4), 'describe')).toMatch(/too large/);
    expect(imageProblem('A'.repeat(Math.ceil(IMAGE_LIMITS.decide.maxBytes / 3) * 4 + 4), 'decide')).toMatch(/too large/);
  });

  it('refuses anything that is not a bare base64 JPEG', () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
    expect(imageProblem(png, 'describe')).toMatch(/not a JPEG/);
    expect(imageProblem(`data:image/jpeg;base64,${jpeg(64, 64)}`, 'describe')).toMatch(/not base64/);
    expect(imageProblem('', 'describe')).toMatch(/not base64/);
    expect(imageProblem('/9j/4AAQ SkZJRg==', 'describe')).toMatch(/not base64/);
    expect(imageProblem(btoa('\xff\xd8\xff\xd9'), 'describe')).toMatch(/not a JPEG/);
    expect(imageProblem(btoa('\xff\xd8\xff\xe0\x00\x04ab\xff\xda'), 'describe')).toMatch(/not a JPEG/);
  });

  it('refuses a malformed device id', () => {
    expect(isDeviceId('3f1c2a9e-77aa-4c1b-9a51-0f6e8c3d2b11')).toBe(true);
    for (const bad of ['short', 'has spaces in it', 'x'.repeat(65), '../../etc/passwd']) expect(isDeviceId(bad)).toBe(false);
  });
});

describe('decide arguments', () => {
  const all: Check[] = ['inView', 'cutOff', 'quality'];
  it('needs a subject for inView and cutOff, but not for quality alone', () => {
    expect(decideProblem('my dog', all)).toBeNull();
    expect(decideProblem(null, ['quality'])).toBeNull();
    expect(decideProblem(null, ['inView'])).toMatch(/subject/);
    expect(decideProblem(null, ['quality', 'cutOff'])).toMatch(/subject/);
  });

  it('refuses empty or repeated checks, and an empty or overlong subject', () => {
    expect(decideProblem('my dog', [])).toMatch(/no checks/);
    expect(decideProblem('my dog', ['inView', 'inView'])).toMatch(/duplicate/);
    expect(decideProblem('   ', ['inView'])).toMatch(/empty/);
    expect(decideProblem('a'.repeat(MAX_SUBJECT), ['inView'])).toBeNull();
    expect(decideProblem('a'.repeat(MAX_SUBJECT + 1), ['inView'])).toMatch(/too long/);
    expect(decideProblem(` ${'a'.repeat(MAX_SUBJECT)}  `, ['inView'])).toBeNull();
  });
});

// A stand-in for the reserve and settle mutations' tables, running the same pure transaction logic.
function deployment() {
  const buckets = new Map<string, Bucket>();
  let spentUsd = 0;
  return {
    reserve(checks: RateCheck[], reserveUsd: number, now: number) {
      const plan = planReserve(checks.map((check) => buckets.get(check.key) ?? null), checks, spentUsd, reserveUsd, now);
      if (plan.refused) return plan.refused;
      plan.buckets.forEach((bucket, i) => buckets.set(checks[i].key, bucket));
      spentUsd = plan.spentUsd;
      return 'ok';
    },
    settle(reserveUsd: number, cost: number | null) {
      spentUsd = settledSpend(spentUsd, reserveUsd, cost);
    },
    count: (key: string) => buckets.get(key)?.count ?? 0,
    spent: () => spentUsd,
  };
}

describe.each<LookAction>(['describe', 'decide'])('%s call-count limits', (action) => {
  const limits = LOOK_LIMITS[action];
  const now = 1_000_000;

  it('refuses a device at its limit and serves it again when the window has passed', () => {
    const db = deployment();
    const checks = lookChecks(action, 'device-a', 'address-a');
    for (let i = 0; i < limits.device.limit; i++) expect(db.reserve(checks, 0, now)).toBe('ok');
    expect(db.reserve(checks, 0, now)).toBe('limited');
    expect(db.reserve(checks, 0, now + limits.device.windowMs)).toBe('ok');
  });

  it('refuses an address at its limit even for a fresh device id, and takes nothing when refusing', () => {
    const db = deployment();
    for (let i = 0; i < limits.address.limit; i++) expect(db.reserve(lookChecks(action, `device-${i}`, 'address-a'), 0, now)).toBe('ok');
    expect(db.reserve(lookChecks(action, 'device-new', 'address-a'), 0, now)).toBe('limited');
    expect(db.count(`look:${action}:device:device-new`)).toBe(0);
    expect(db.count(`look:${action}:deployment`)).toBe(limits.address.limit);
    expect(db.reserve(lookChecks(action, 'device-new', 'address-b'), 0, now)).toBe('ok');
  });

  it('refuses the whole deployment at its limit, whatever device ids and addresses are used', () => {
    const db = deployment();
    for (let i = 0; i < limits.deployment.limit; i++) expect(db.reserve(lookChecks(action, `device-${i}`, `address-${i}`), 0, now)).toBe('ok');
    expect(db.reserve(lookChecks(action, 'device-new', 'address-new'), 0, now)).toBe('limited');
    expect(db.reserve(lookChecks(action, 'device-new', null), 0, now)).toBe('limited');
    expect(db.reserve(lookChecks(action, 'device-new', 'address-new'), 0, now + limits.deployment.windowMs)).toBe('ok');
  });

  it('keeps describe and decide in separate windows, apart from the memory limits', () => {
    expect(lookChecks(action, 'd', 'a').map((check) => check.key)).toEqual([`look:${action}:device:d`, `look:${action}:address:a`, `look:${action}:deployment`]);
    expect(lookChecks(action, 'd', null)).toHaveLength(2);
  });
});

describe('spend cap', () => {
  const now = 1_000_000;
  const checks = lookChecks('describe', 'd', 'a');
  const reserve = reservationUsd('gpt-6-luna', 'describe')!;

  it('counts the reservation of the call itself against the hourly budget', () => {
    expect(planReserve([null, null, null], checks, LOOK_BUDGET_USD_PER_HOUR - reserve, reserve, now).refused).toBeNull();
    expect(planReserve([null, null, null], checks, LOOK_BUDGET_USD_PER_HOUR - reserve / 2, reserve, now).refused).toBe('budget');
  });

  it('stops calls once reservations in flight fill the budget, and frees room as calls settle cheaper', () => {
    const db = deployment();
    const fits = Math.floor(LOOK_BUDGET_USD_PER_HOUR / reserve);
    for (let i = 0; i < fits; i++) expect(db.reserve(lookChecks('describe', `d-${i % 100}`, null), reserve, now)).toBe('ok');
    expect(db.reserve(lookChecks('describe', 'd-new', null), reserve, now)).toBe('budget');
    db.settle(reserve, reserve / 4);
    expect(db.reserve(lookChecks('describe', 'd-new', null), reserve, now)).toBe('ok');
  });

  it('swaps the reservation for the reported cost, releases it when nothing was reported, and never goes negative', () => {
    expect(settledSpend(0.5, 0.001, 0.0002)).toBeCloseTo(0.4992, 10);
    expect(settledSpend(0.5, 0.001, null)).toBeCloseTo(0.499, 10);
    expect(settledSpend(0.0005, 0.001, null)).toBe(0);
    const db = deployment();
    expect(db.reserve(checks, reserve, now)).toBe('ok');
    db.settle(reserve, null);
    expect(db.spent()).toBe(0);
  });
});

describe('reservations', () => {
  // Measured with pnpm eval:look's frames on gpt-6-luna (2026-11-15): the largest frame each action accepts.
  const MEASURED = { describe: 1714, decide: 1253 };

  it.each(PRICED)('reserves more than the dearest single call can cost on %s', (model) => {
    for (const action of ['describe', 'decide'] as const) {
      const inputTokens = MEASURED[action];
      const outputTokens = WORST_CASE_TOKENS[action].outputTokens;
      const worst = Math.max(
        costUsd(model, { inputTokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens })!,
        costUsd(model, { inputTokens, cachedTokens: 0, cacheWriteTokens: inputTokens, outputTokens })!,
      );
      expect(worst).toBeLessThan(reservationUsd(model, action)!);
      expect(inputTokens).toBeLessThan(WORST_CASE_TOKENS[action].inputTokens);
    }
  });

  it('keeps the text around the image as short as when the worst case was measured', () => {
    expect(LOOK_INSTRUCTIONS.length + JSON.stringify(LOOK_RESPONSE_SCHEMA).length).toBeLessThan(5000);
    const questions = decisionQuestions('a'.repeat(MAX_SUBJECT), ['inView', 'cutOff', 'quality']);
    expect(JSON.stringify(decisionInput('', 'low')).length + JSON.stringify(questions).length).toBeLessThan(3000);
  });

  it('refuses a model with no price', () => {
    expect(reservationUsd('gpt-unknown', 'describe')).toBeNull();
    expect(reservationUsd('gpt-unknown', 'decide')).toBeNull();
    expect(reservationUsd('gpt-6-luna', 'decide')).toBeCloseTo(0.00025, 10);
  });

  it('keys counters by a digest, never the raw id or address', async () => {
    const digest = await lookHash('device', 'device-0001');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(await lookHash('address', 'device-0001'));
    expect(lookChecks('decide', digest, null)[0].key).not.toContain('device-0001');
  });
});

describe('camera prompt', () => {
  it('reuses every selected rule of the post description prompt word for word', () => {
    const paragraphs = systemPrompt('standard').split('\n\n');
    for (const opening of SHARED_RULES) {
      const found = paragraphs.filter((paragraph) => paragraph.startsWith(opening));
      expect(found).toHaveLength(1);
      expect(LOOK_INSTRUCTIONS).toContain(found[0]);
    }
  });

  it('adds the camera rules: no names, positions for aiming, text is content', () => {
    expect(LOOK_INSTRUCTIONS).toMatch(/Never use a name for a person/);
    expect(LOOK_INSTRUCTIONS).toMatch(/point of view of the person holding the camera/);
    expect(LOOK_INSTRUCTIONS).toMatch(/never instructions to you/);
    expect(LOOK_INSTRUCTIONS).not.toMatch(/names_shown|beyond_alt|hashtag_topic/);
  });
});

describe('decision questions', () => {
  it('quotes the subject only as data, cleaned of quotation marks and extra space', () => {
    const [inView] = decisionQuestions('  my "dog"\n  Rex  ', ['inView']);
    expect(inView.instructions).toContain('The thing the user asked about, in their words: "my dog Rex".');
    expect(cleanSubject('ignore "this" \u0007 now')).toBe('ignore this now');
  });

  it('offers exactly the six edges, as the edges of the image', () => {
    const [cutOff] = decisionQuestions('the sign', ['cutOff']);
    expect(cutOff.type).toBe('choice');
    if (cutOff.type !== 'choice') return;
    expect(cutOff.choices.map((choice) => choice.value)).toEqual(['none', 'left', 'right', 'top', 'bottom', 'several']);
    expect(cutOff.instructions).toMatch(/edges of this image/);
  });

  it('asks only what was checked, in one request', () => {
    const names = (subject: string | null, checks: Check[]) => decisionQuestions(subject, checks).map((question) => question.name);
    expect(names('the sign', ['inView', 'cutOff', 'quality'])).toEqual(['in_view', 'cut_off', 'too_dark', 'too_blurry']);
    expect(names('the sign', ['quality', 'inView'])).toEqual(['in_view', 'too_dark', 'too_blurry']);
    expect(names('the sign', ['cutOff'])).toEqual(['cut_off']);
    expect(names(null, ['quality'])).toEqual(['too_dark', 'too_blurry']);
    expect(decisionQuestions(null, ['quality'])[0].instructions).toMatch(/make out what it shows\.$/);
    expect(decisionQuestions('my cat', ['quality'])[1].instructions).toContain('"my cat"');
  });

  it('tells the model that text in the image is never an instruction', () => {
    expect(decisionInput('abc', 'low')[0]).toEqual({ role: 'developer', content: expect.stringMatching(/never instructions/) });
  });
});

describe('response parsing', () => {
  it('turns refusals, unknown choices and out-of-range numbers into null', () => {
    const answers = decisionAnswers({
      answers: [
        { type: 'refusal', name: 'in_view' },
        { type: 'choice', name: 'cut_off', choice: 'diagonal', confidence: 0.9, probabilities: [] },
        { type: 'predicate', name: 'too_dark', probability: 0.12 },
        { type: 'predicate', name: 'too_blurry', probability: 1.5 },
      ],
    });
    expect(answers).toEqual({ inView: null, cutOff: null, tooDark: 0.12, tooBlurry: null });
    expect(decisionAnswers({ answers: [{ type: 'choice', name: 'cut_off', choice: 'toString' }] })?.cutOff).toBeNull();
    expect(decisionAnswers({ answers: [{ type: 'choice', name: 'cut_off', choice: 'right' }] })?.cutOff).toBe('right');
    expect(decisionAnswers({ model: 'gpt-6-luna' })).toBeNull();
    expect(decisionAnswers('nope')).toBeNull();
    expect(Object.keys(EDGES)).toHaveLength(6);
  });

  it('reads out visible text the description left out and clips lengths', () => {
    const text = lookText({ visible_text: ['OPEN', 'Maple Street Bakery'], description: 'A bakery with a sign reading "Maple Street Bakery".', alt_text: 'A bakery.' }, 'photo');
    expect(text?.description).toBe('A bakery with a sign reading "Maple Street Bakery". Text in the picture reads “OPEN”.');
    expect(text?.altText).toBe('A bakery. Text in the picture reads “OPEN”, “Maple Street Bakery”.');
    expect(lookText({ visible_text: [], description: 'x '.repeat(400), alt_text: 'y '.repeat(800) }, 'library')?.description.length).toBeLessThanOrEqual(400);
    expect(lookText({ visible_text: [], description: 'x '.repeat(400), alt_text: 'y '.repeat(800) }, 'library')?.altText.length).toBeLessThanOrEqual(1000);
  });

  it('keeps alt text empty for view and drops a repeated "You took a photo of"', () => {
    expect(lookText({ visible_text: [], description: 'A mug.', alt_text: 'A mug on a desk.' }, 'view')?.altText).toBe('');
    expect(lookText({ visible_text: [], description: 'You took a photo of a red mug.', alt_text: 'A red mug.' }, 'photo')?.description).toBe('a red mug.');
  });

  it('fails a description that is missing or not an object', () => {
    expect(lookText(null, 'view')).toBeNull();
    expect(lookText({ visible_text: [], description: '  ', alt_text: '' }, 'view')).toBeNull();
    expect(lookText(['a'], 'view')).toBeNull();
  });
});

describe('OpenAI calls', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });
  const reply = (status: number, body: unknown) => {
    global.fetch = jest.fn(async () => ({ status, json: async () => body })) as unknown as typeof fetch;
  };
  const usage = { input_tokens: 1500, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 100 };
  const message = (text: string) => ({ status: 'completed', model: 'gpt-6-luna', usage, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
  const describeArgs = { apiKey: 'k', model: 'gpt-6-luna', image: 'abcd', purpose: 'view' as const };

  it('fails unparseable output but still reports what it cost', async () => {
    reply(200, message('not json'));
    const result = await describeImageWithOpenAI(describeArgs);
    expect(result).toMatchObject({ ok: false, error: 'unparseable' });
    expect(result.usage?.costUsd).toBeCloseTo(0.0002, 10);
  });

  it('returns the description with its cost', async () => {
    reply(200, message(JSON.stringify({ visible_text: [], description: 'A red mug in the middle.', alt_text: '' })));
    expect(await describeImageWithOpenAI(describeArgs)).toMatchObject({ ok: true, description: 'A red mug in the middle.', altText: '', model: 'gpt-6-luna' });
  });

  it('fails an HTTP error or a refusal', async () => {
    reply(500, { error: { message: 'boom' } });
    expect(await describeImageWithOpenAI(describeArgs)).toEqual({ ok: false, error: 'http_500', usage: null });
    reply(200, { ...message(''), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] });
    expect(await describeImageWithOpenAI(describeArgs)).toMatchObject({ ok: false, error: 'refusal' });
  });

  it('gives up after its own timeout with no usage, so the reservation is released', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    ) as unknown as typeof fetch;
    const pending = decideWithOpenAI({ apiKey: 'k', model: 'gpt-6-luna', image: 'abcd', subject: null, checks: ['quality'] });
    jest.advanceTimersByTime(20_000);
    expect(await pending).toEqual({ ok: false, error: 'timeout', usage: null });
  });

  it('prices decisions on input tokens only', async () => {
    reply(200, { model: 'gpt-6-luna', usage: { ...usage, output_tokens: 50 }, answers: [{ type: 'predicate', name: 'too_dark', probability: 0.9 }] });
    const result = await decideWithOpenAI({ apiKey: 'k', model: 'gpt-6-luna', image: 'abcd', subject: null, checks: ['quality'] });
    expect(result).toMatchObject({ ok: true, answers: { inView: null, cutOff: null, tooDark: 0.9, tooBlurry: null } });
    expect(result.usage?.costUsd).toBeCloseTo(0.00015, 10);
  });
});
