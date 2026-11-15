// Tells the app's own words (spoken with say()) apart from the model's own speech, since both come back as
// assistant transcripts, and tells the app when one of its read-backs has been spoken to the end. Only the model's
// speech voids a read-back the user hasn't answered yet. Vapi's voice formatting rewrites text before it is spoken
// (digits to words, colons to full stops, acronyms lowercased), so the transcript of a say() is not the text that
// was passed to it, and Vapi delivers one utterance as several final transcripts, one per stretch of speech.
//
// The rule: when in doubt, it was the model. Wherever the signals are missing or disagree, speech is put down to the
// model, which voids the pending yes and costs the user one more read-back, and never publishes on a yes that may
// have answered the model.
//
// 1. Vapi's assistant.speechStarted names the source of each segment. Only "force-say" (say() and the first
//    message) is the app; "model", "custom-voice" or any other named source is not. When Vapi named a source for
//    the current segment, that alone decides who spoke. It is opt-in, requested in clientMessages (assistant.ts).
// 2. Only when Vapi named no source: the segment is the app's if a say() was due when an assistant speech-update
//    "started" arrived (from the call until its speech starts, with a time limit in case Vapi never reports it),
//    and the segment's transcripts so far, joined, are the start of that say()'s words after formatting. Vapi's own
//    transcriber sometimes drops a word of the agent's speech or adds one ("you know"), so up to one word in eight
//    may be missing or extra, together, but no more: the model's own speech differs in far more. Never a word that
//    carries the meaning's polarity or amount: a negation (not, no, never, any n't word, without, except) or a
//    number can't be the one missing or extra. A segment that stops short of the end is settled as the model's when
//    the user next speaks or the next segment starts. Numbers and ordinals are compared as "a number here" (Vapi
//    says 4:30 as four thirty, the transcriber writes first as 1st), so one can't go missing or appear.
// 4. Model speech counts from the moment it starts, not from its transcript, which arrives after the speech: a
//    segment named for any source but force-say, or a speech-update "started" with no say() due, is the model's
//    at once, so a yes said while the model is still asking its own question can't answer the read-back.
// 5. Inside a segment named force-say, words past the end of every due say() are the model's.
// 3. Either way, a say() counts as spoken in full once the segment's joined transcripts have covered all its words.
//    Several say()s spoken back to back in one segment are matched one after another.

export type Speaker = 'app' | 'model';

export type Attribution = {
  speaker: Speaker;
  by: 'source' | 'timing and words';
  source: string | null;
  turn: unknown;
  // The tags of the say()s this transcript finished, in order: read-backs the user has now heard to the end.
  finished: string[];
};

const NUMBER_WORDS = new Set(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth twentieth thirtieth hundredth'.split(' '),
);
const IGNORED = new Set('point minus and a at dot'.split(' '));
const NUMBER = '#';

// Words that may never be the one dropped in transit, since losing one changes what the post says.
const KEPT = new Set([
  NUMBER,
  ...'not no never nor none nothing nobody nowhere neither without except cannot'.split(' '),
  ...'dont doesnt didnt isnt arent wasnt werent cant couldnt wont wouldnt shouldnt hasnt havent hadnt aint mustnt neednt'.split(' '),
]);

// The words that survive formatting: any run of digits and number words is one NUMBER, and the "at" and "dot" the
// formatter adds are dropped.
export const wordsOf = (text: string) => {
  const words: string[] = [];
  for (const word of text.toLowerCase().replace(/['’]/g, '').match(/\d+(?:st|nd|rd|th)\b|[a-z]+|\d+/g) ?? []) {
    if (IGNORED.has(word)) continue;
    const token = /\d/.test(word) || NUMBER_WORDS.has(word) ? NUMBER : word;
    if (token !== NUMBER || words[words.length - 1] !== NUMBER) words.push(token);
  }
  return words;
};

// Matches heard words against a say()'s words in order, with up to one word in eight of the say() missing from what
// was heard or added to it. Null when the heard words leave the say() (a word it doesn't have next); otherwise whether they reached
// its end, and any heard words after it.
function match(said: string[], heard: string[]): { done: boolean; rest: string[] } | null {
  let skips = Math.max(1, Math.floor(said.length / 8));
  let at = 0;
  for (let i = 0; i < heard.length; i++) {
    if (at === said.length) return { done: true, rest: heard.slice(i) };
    let next = at;
    while (next < said.length && said[next] !== heard[i] && next - at < skips && !KEPT.has(said[next])) next += 1;
    if (said[next] !== heard[i] && skips > 0 && !KEPT.has(heard[i])) {
      skips -= 1;
      continue;
    }
    if (said[next] !== heard[i]) return null;
    skips -= next - at;
    at = next + 1;
  }
  return { done: at === said.length, rest: [] };
}

type Say = { words: string[]; tag: string | null; until: number };

// heard: words transcribed in this segment and not yet matched to a finished say(). chained: a say() finished in
// this segment, so the next one due may follow in it. model: the segment was put down to the model, and so is the rest.
type Segment = { turn: unknown; source: string | null; say: Say | null; heard: string[]; chained: boolean; model: boolean };

export class AgentVoice {
  // Each say() whose speech hasn't started yet, with when it stops counting as due.
  private due: Say[] = [];
  private segment: Segment | null = null;

  constructor(private readonly now: () => number) {}

  // tag names what was said, for the app to hear back once it has been spoken in full (a draft's id for a read-back).
  // interrupts: Vapi drops whatever was queued before it, so no earlier say() is still due.
  appSays(text: string, tag: string | null = null, interrupts = false): void {
    if (interrupts) this.due = [];
    this.due.push({ words: wordsOf(text), tag, until: this.now() + 4000 + text.length * 90 });
  }

  // speech-update "started" for the assistant. A segment Vapi already named for this turn stays as it is; its
  // later segments arrive with their own source reports. Returns the settlement of a segment that stopped short.
  speechStarted(turn: unknown): Attribution | null {
    if (this.segment?.source && turn !== undefined && this.segment.turn === turn) return null;
    const settled = this.settle();
    const say = this.takeDue();
    this.segment = { turn, source: null, say, heard: [], chained: false, model: !say };
    if (say) return settled;
    return settled ?? { speaker: 'model', by: 'timing and words', source: null, turn, finished: [] };
  }

  // assistant.speechStarted, sent for every segment. A report with no source says nothing about who is speaking.
  // A source that differs from the current segment's, or a new turn, starts a new segment.
  // Returns the model's attribution as soon as it names a source other than force-say.
  sourceReported(source: unknown, turn: unknown): Attribution | null {
    if (typeof source !== 'string' || !source) return null;
    const current = this.segment;
    if (current?.source === source && current.turn === turn) return null;
    const unnamedThisTurn = current && !current.source && current.turn === turn ? current : null;
    if (unnamedThisTurn?.say && source !== 'force-say') this.due.unshift({ ...unnamedThisTurn.say, until: this.now() + 4000 });
    const keep = source === 'force-say' && unnamedThisTurn && !unnamedThisTurn.model ? unnamedThisTurn : null;
    this.segment = { turn, source, say: source === 'force-say' ? (keep?.say ?? this.takeDue()) : null, heard: keep?.heard ?? [], chained: keep?.chained ?? false, model: false };
    return source === 'force-say' ? null : { speaker: 'model', by: 'source', source, turn, finished: [] };
  }

  // Who said a final assistant transcript, which signal decided it, and which say()s it finished.
  attribute(transcript: string): Attribution {
    const segment = this.segment;
    if (!segment) return { speaker: 'model', by: 'timing and words', source: null, turn: undefined, finished: [] };
    const base = { source: segment.source, turn: segment.turn };
    const named = segment.source !== null;
    if (named && segment.source !== 'force-say') return { ...base, speaker: 'model', by: 'source', finished: [] };
    if (segment.model) return { ...base, speaker: 'model', by: 'timing and words', finished: [] };
    const words = wordsOf(transcript);
    if (words[0] === NUMBER && segment.heard[segment.heard.length - 1] === NUMBER) words.shift();
    segment.heard.push(...words);
    const finished: string[] = [];
    for (;;) {
      if (!segment.say && segment.chained && segment.heard.length) segment.say = this.takeDue();
      const matched = segment.say ? match(segment.say.words, segment.heard) : null;
      if (!segment.say || !matched?.done) break;
      if (segment.say.tag) finished.push(segment.say.tag);
      segment.heard = matched.rest;
      segment.say = null;
      segment.chained = true;
    }
    if (named && !(segment.heard.length && !segment.say)) return { ...base, speaker: 'app', by: 'source', finished };
    if (named) {
      segment.model = true;
      return { ...base, speaker: 'model', by: 'timing and words', finished };
    }
    const fits = segment.heard.length === 0 ? finished.length > 0 || segment.say !== null : segment.say !== null && match(segment.say.words, segment.heard) !== null;
    if (fits) return { ...base, speaker: 'app', by: 'timing and words', finished };
    segment.model = true;
    segment.say = null;
    return { ...base, speaker: 'model', by: 'timing and words', finished };
  }

  // A segment Vapi named no source for that ended partway through a say(): when in doubt, the model. Called before
  // the user's words are acted on and when a new segment starts.
  settle(): Attribution | null {
    const segment = this.segment;
    if (!segment || segment.source || segment.model || !segment.say || !segment.heard.length) return null;
    segment.model = true;
    segment.say = null;
    return { speaker: 'model', by: 'timing and words', source: null, turn: segment.turn, finished: [] };
  }

  private takeDue(): Say | null {
    const now = this.now();
    this.due = this.due.filter((say) => say.until > now);
    return this.due.shift() ?? null;
  }
}
