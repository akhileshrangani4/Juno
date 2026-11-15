import { ConvexHttpClient } from 'convex/browser';
import { decode, encode } from 'jpeg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEV_FRAMES } from '../assets/dev-frames';
import { api } from '../convex/_generated/api';
import { imageProblem, IMAGE_LIMITS, type Check, type LookAction } from '../convex/lookLimits';
import { DECISION_DETAIL, DEFAULT_DECISION_MODEL, DEFAULT_LOOK_MODEL, decideWithOpenAI, describeImageWithOpenAI } from '../convex/lookOpenAI';
import type { Answers, Purpose } from '../convex/lookPrompt';

// Sends every frame in assets/dev-frames through the camera's describe and decide calls, with the same prompt,
// schema, questions and OpenAI code as convex/look.ts, and writes what came back to EVAL_LOOK_LOG (default
// look-eval.md, never committed). Frames are downscaled first as the phone does: 768 px on the long side for
// describe, 512 for decide.
//   OPENAI_API_KEY=... pnpm eval:look [--runs 3] [--compare-detail]
//   pnpm eval:look --convex https://<deployment>.convex.cloud     (calls the deployed actions, end to end)
// --compare-detail also asks every decision with image detail "auto" and reports whether the answers agree.

type Described = { ok: true; description: string; altText: string; visibleText: string[]; costUsd: number | null } | { ok: false; reason: string; costUsd: number | null };
type Decided = ({ ok: true; costUsd: number | null; inputTokens: number | null } & Answers) | { ok: false; reason: string; costUsd: number | null };
type Timed<T> = T & { ms: number };

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const runs = Number(flag('--runs') ?? 3);
const convexUrl = flag('--convex');
const compareDetail = argv.includes('--compare-detail');
const apiKey = process.env.OPENAI_API_KEY ?? '';
const describeModel = process.env.LOOK_MODEL || DEFAULT_LOOK_MODEL;
const decisionModel = process.env.LOOK_DECISION_MODEL || DEFAULT_DECISION_MODEL;
const client = convexUrl ? new ConvexHttpClient(convexUrl) : null;
const deviceId = `look-eval-${Math.random().toString(16).slice(2, 14)}`;

// Area-average downscale to fit maxSide, then JPEG at quality 80, like the app's resize before sending.
function downscale(file: string, maxSide: number): string {
  const source = decode(readFileSync(file), { useTArray: true });
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [x0, x1] = [Math.floor(x / scale), Math.max(Math.floor(x / scale) + 1, Math.floor((x + 1) / scale))];
      const [y0, y1] = [Math.floor(y / scale), Math.max(Math.floor(y / scale) + 1, Math.floor((y + 1) / scale))];
      const sum = [0, 0, 0];
      for (let sy = y0; sy < Math.min(y1, source.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, source.width); sx++) {
          for (let c = 0; c < 3; c++) sum[c] += source.data[(sy * source.width + sx) * 4 + c];
        }
      }
      const n = (Math.min(y1, source.height) - y0) * (Math.min(x1, source.width) - x0);
      for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = Math.round(sum[c] / n);
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return encode({ width, height, data }, 80).data.toString('base64');
}

async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const started = Date.now();
  const result = await run();
  return { ...result, ms: Date.now() - started };
}

async function describeFrame(image: string, purpose: Purpose): Promise<Timed<Described>> {
  if (client) return timed(() => client.action(api.look.describeImage, { image, deviceId, purpose }).then((r) => (r.ok ? r : { ...r, costUsd: null })));
  return timed(async () => {
    const r = await describeImageWithOpenAI({ apiKey, model: describeModel, image, purpose });
    return r.ok ? { ...r, costUsd: r.usage.costUsd } : { ok: false as const, reason: r.error, costUsd: r.usage?.costUsd ?? null };
  });
}

async function decideFrame(image: string, subject: string | null, checks: Check[], detail: 'low' | 'auto'): Promise<Timed<Decided>> {
  if (client) return timed(() => client.action(api.look.decide, { image, deviceId, subject, checks }).then((r) => (r.ok ? { ...r, inputTokens: null } : { ...r, costUsd: null })));
  return timed(async () => {
    const r = await decideWithOpenAI({ apiKey, model: decisionModel, image, subject, checks, detail });
    return r.ok ? { ok: true as const, ...r.answers, costUsd: r.usage.costUsd, inputTokens: r.usage.inputTokens } : { ok: false as const, reason: r.error, costUsd: r.usage?.costUsd ?? null };
  });
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const usd = (value: number) => `$${value.toFixed(6)}`;
const latency = (results: Timed<unknown>[]) => `${median(results.map((r) => r.ms))} / ${Math.max(...results.map((r) => r.ms))} ms`;
const costs = (results: { costUsd: number | null }[]) => results.map((r) => r.costUsd).filter((cost): cost is number => cost !== null);
const costCell = (results: { costUsd: number | null }[]) => (costs(results).length ? usd(mean(costs(results))) : 'unknown');
const pct = (value: number | null) => (value === null ? 'null' : value.toFixed(2));
const answerText = (r: Decided) => (r.ok ? `in view ${pct(r.inView)}, cut off ${r.cutOff ?? 'null'}, dark ${pct(r.tooDark)}, blurry ${pct(r.tooBlurry)}` : `failed: ${r.reason}`);

async function main() {
  if (!client && !apiKey) throw new Error('Set OPENAI_API_KEY, or pass --convex <deployment url>');
  const describeRows: string[] = [];
  const decideRows: string[] = [];
  const detailRows: string[] = [];
  const allDescribed: Timed<Described>[] = [];
  const allDecided: Timed<Decided>[] = [];
  let agreements = 0;
  for (const frame of DEV_FRAMES) {
    const file = join(__dirname, '..', 'assets', 'dev-frames', `${frame.name}.jpg`);
    const images = { describe: downscale(file, IMAGE_LIMITS.describe.maxSide), decide: downscale(file, IMAGE_LIMITS.decide.maxSide) };
    for (const action of ['describe', 'decide'] as LookAction[]) {
      const problem = imageProblem(images[action], action);
      if (problem) throw new Error(`${frame.name} would be refused by ${action}: ${problem}`);
    }
    for (const purpose of ['view', 'photo'] as Purpose[]) {
      const results: Timed<Described>[] = [];
      for (let i = 0; i < runs; i++) results.push(await describeFrame(images.describe, purpose));
      allDescribed.push(...results);
      const first = results.find((r) => r.ok) ?? results[0];
      const failures = results.flatMap((r) => (r.ok ? [] : [r.reason]));
      const text = first.ok ? [first.description, first.altText || '—', first.visibleText.map((piece) => `“${piece}”`).join(', ') || '—'] : [`failed: ${first.reason}`, '', ''];
      describeRows.push(`| ${frame.name} | ${purpose} | ${text.map(cell).join(' | ')} | ${failures.length}/${runs}${failures.length ? ` (${failures.join(', ')})` : ''} | ${latency(results)} | ${costCell(results)} |`);
      console.log(`${frame.name} ${purpose}: ${latency(results)}`);
    }
    const checks: Check[] = frame.subject ? ['inView', 'cutOff', 'quality'] : ['quality'];
    const results: Timed<Decided>[] = [];
    for (let i = 0; i < runs; i++) results.push(await decideFrame(images.decide, frame.subject, checks, DECISION_DETAIL));
    allDecided.push(...results);
    decideRows.push(`| ${frame.name} | ${frame.subject ?? '—'} | ${results.map((r) => cell(answerText(r))).join('<br>')} | ${latency(results)} | ${costCell(results)} |`);
    console.log(`${frame.name} decide: ${latency(results)}`);
    if (compareDetail && !client) {
      const other = DECISION_DETAIL === 'low' ? 'auto' : 'low';
      const alternatives: Timed<Decided>[] = [];
      for (let i = 0; i < runs; i++) alternatives.push(await decideFrame(images.decide, frame.subject, checks, other));
      const verdict = (r: Decided) => (r.ok ? [r.inView === null ? null : r.inView >= 0.5, r.cutOff, r.tooDark === null ? null : r.tooDark >= 0.5, r.tooBlurry === null ? null : r.tooBlurry >= 0.5].join() : 'failed');
      const agree = new Set([...results, ...alternatives].map(verdict)).size === 1;
      if (agree) agreements++;
      const tokens = (list: Decided[]) => list.map((r) => (r.ok ? r.inputTokens : '—')).join(', ');
      detailRows.push(`| ${frame.name} | ${cell(answerText(results[0]))} | ${cell(answerText(alternatives[0]))} | ${agree ? 'yes' : 'no'} | ${tokens(results)} | ${tokens(alternatives)} | ${latency(results)} | ${latency(alternatives)} |`);
    }
  }
  const okDescribed = allDescribed.filter((r) => r.ok);
  const okDecided = allDecided.filter((r) => r.ok);
  const lines = [
    '# Camera look eval',
    '',
    `${client ? `Deployed actions at ${convexUrl} (latency is end to end from this machine)` : `OpenAI directly: describe ${describeModel}, decide ${decisionModel} with detail "${DECISION_DETAIL}"`}, ${runs} runs per frame, ${new Date().toISOString()}.`,
    'Frames are downscaled as the phone does: 768 px long side (576 x 768) for describe, 512 (384 x 512) for decide. Latency is median / max over the runs; cost is the mean per call.',
    '',
    '## Describe',
    '',
    '| Frame | Purpose | Description (first run) | Alt text | Visible text | Failed | Latency | Cost per call |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...describeRows,
    '',
    '## Decide (in view, cut off, quality in one call)',
    '',
    '| Frame | Subject | Answers, one line per run | Latency | Cost per call |',
    '| --- | --- | --- | --- | --- |',
    ...decideRows,
    '',
    '## Averages',
    '',
    `- Described frames: ${okDescribed.length} of ${allDescribed.length} succeeded. Mean cost ${costs(okDescribed).length ? usd(mean(costs(okDescribed))) : 'unknown'}, median latency ${median(allDescribed.map((r) => r.ms))} ms, max ${Math.max(...allDescribed.map((r) => r.ms))} ms.`,
    `- Decision checks: ${okDecided.length} of ${allDecided.length} succeeded. Mean cost ${costs(okDecided).length ? usd(mean(costs(okDecided))) : 'unknown'}, median latency ${median(allDecided.map((r) => r.ms))} ms, max ${Math.max(...allDecided.map((r) => r.ms))} ms.`,
    ...(detailRows.length
      ? [
          '',
          `## Decision image detail: "${DECISION_DETAIL}" against "${DECISION_DETAIL === 'low' ? 'auto' : 'low'}"`,
          '',
          `Answers agree (every run of both, rounded at 0.5, same edge) on ${agreements} of ${detailRows.length} frames.`,
          '',
          `| Frame | ${DECISION_DETAIL} (first run) | other (first run) | Agree | Input tokens ${DECISION_DETAIL} | Input tokens other | Latency ${DECISION_DETAIL} | Latency other |`,
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          ...detailRows,
        ]
      : []),
    '',
  ];
  const out = process.env.EVAL_LOOK_LOG ?? 'look-eval.md';
  writeFileSync(out, lines.join('\n'));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
