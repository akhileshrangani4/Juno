// Tells the app's own words (spoken with say()) apart from the model's own speech, since both come back as
// assistant transcripts. Only the model's speech voids a read-back the user hasn't answered yet. Vapi's voice
// formatting rewrites text before it is spoken (digits to words, colons to full stops, acronyms lowercased), so
// the transcript of a say() is not the text that was passed to it, and an exact match isn't enough.
//
// The rule: when in doubt, it was the model. Wherever the signals are missing or disagree, speech is put down to the
// model, which voids the pending yes and costs the user one more read-back, and never publishes on a yes that may
// have answered the model.
//
// 1. Vapi's assistant.speechStarted names the source of each segment. Only "force-say" (say() and the first
//    message) is the app; "model", "custom-voice" or any other named source is not. When Vapi named a source for
//    the current segment, that alone decides. It is opt-in, requested in clientMessages (assistant.ts).
// 2. Only when Vapi named no source: the segment is the app's if a say() was due when an assistant speech-update
//    "started" arrived (from the call until its speech starts, with a time limit in case Vapi never reports it),
//    and the transcript is that text, allowing for the formatter's changes. Either one alone is not enough.

export type Speaker = 'app' | 'model';

export type Attribution = { speaker: Speaker; by: 'source' | 'timing and words'; source: string | null; turn: unknown };

const IGNORED = new Set(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million point minus and a at dot'.split(
    ' ',
  ),
);

// The words that survive formatting: numbers, number words and the "at" and "dot" the formatter adds are dropped.
const wordsOf = (text: string) => (text.toLowerCase().replace(/['’]/g, '').match(/[a-z]+|\d+/g) ?? []).filter((word) => !IGNORED.has(word) && !/\d/.test(word)).join(' ');

type Segment = { turn: unknown; source: string | null; due: boolean; text: string | null };

export class AgentVoice {
  // Each say() whose speech hasn't started yet, with when it stops counting as due.
  private due: { text: string; until: number }[] = [];
  private segment: Segment | null = null;

  constructor(private readonly now: () => number) {}

  appSays(text: string): void {
    this.due.push({ text: wordsOf(text), until: this.now() + 4000 + text.length * 90 });
  }

  // speech-update "started" for the assistant. A segment Vapi already named for this turn stays as it is; its
  // later segments arrive with their own source reports.
  speechStarted(turn: unknown): void {
    if (this.segment?.source && turn !== undefined && this.segment.turn === turn) return;
    const now = this.now();
    this.due = this.due.filter((say) => say.until > now);
    const say = this.due.shift() ?? null;
    this.segment = { turn, source: null, due: say !== null, text: say?.text ?? null };
  }

  // assistant.speechStarted, sent for every segment. A report with no source says nothing about who is speaking.
  // A source that differs from the current segment's, or a new turn, starts a new segment.
  sourceReported(source: unknown, turn: unknown): void {
    if (typeof source !== 'string' || !source) return;
    const current = this.segment;
    if (current?.source === source && current.turn === turn) return;
    const unnamedThisTurn = current && !current.source && current.turn === turn ? current : null;
    if (unnamedThisTurn?.due && source !== 'force-say') this.due.unshift({ text: unnamedThisTurn.text ?? '', until: this.now() + 4000 });
    if (source === 'force-say' && !unnamedThisTurn?.due) this.due.shift();
    this.segment = { turn, source, due: source === 'force-say', text: null };
  }

  // Who said a final assistant transcript, and which signal decided it.
  attribute(transcript: string): Attribution {
    const segment = this.segment;
    const base = { source: segment?.source ?? null, turn: segment?.turn };
    if (segment?.source) return { ...base, speaker: segment.source === 'force-say' ? 'app' : 'model', by: 'source' };
    const isTheSay = segment?.due === true && segment.text !== null && wordsOf(transcript) === segment.text;
    return { ...base, speaker: isTheSay ? 'app' : 'model', by: 'timing and words' };
  }
}
