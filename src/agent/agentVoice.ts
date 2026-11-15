// Tells the app's own words (spoken with say()) apart from the model's own speech, since both come back as
// assistant transcripts. Only the model's speech voids a read-back the user hasn't answered yet. Vapi's voice
// formatting rewrites text before it is spoken (digits to words, colons to full stops, acronyms lowercased), so
// the transcript of a say() is not the text that was passed to it, and an exact match isn't enough.
//
// Signals, strongest first:
// 1. Vapi's assistant.speechStarted message names the source of each turn: "force-say" for say(), "model" for the
//    model. It is opt-in, requested in clientMessages (assistant.ts).
// 2. Which of them was due when an assistant speech-update "started" arrived: a say() counts as due from the call
//    until its speech starts, with a generous time limit in case Vapi never reports it.
// 3. The transcript's words, ignoring numbers and the "at" and "dot" the formatter adds, are among the words of
//    something the app said recently.

export type Speaker = 'app' | 'model';

const IGNORED = new Set(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million point minus and a at dot'.split(
    ' ',
  ),
);

const wordsOf = (text: string) => text.toLowerCase().replace(/['’]/g, '').match(/[a-z]+|\d+/g) ?? [];

export class AgentVoice {
  // When each say() whose speech hasn't started yet stops counting as due.
  private due: number[] = [];
  private turn: { id: unknown; speaker: Speaker; tookSay: boolean; reported: boolean } | null = null;
  private recent: Set<string>[] = [];

  constructor(private readonly now: () => number) {}

  appSays(text: string): void {
    this.due.push(this.now() + 4000 + text.length * 90);
    this.recent = [...this.recent.slice(-9), new Set(wordsOf(text))];
  }

  // speech-update with status "started" and role "assistant": a guess from what was due, unless Vapi already
  // reported the source of this turn.
  speechStarted(turn: unknown): void {
    if (turn !== undefined && this.turn?.id === turn) return;
    const now = this.now();
    this.due = this.due.filter((until) => until > now);
    const tookSay = this.due.length > 0;
    if (tookSay) this.due.shift();
    this.turn = { id: turn, speaker: tookSay ? 'app' : 'model', tookSay, reported: false };
  }

  // assistant.speechStarted: sent for every segment of a turn, with the turn's source.
  sourceReported(source: unknown, turn: unknown): void {
    const speaker: Speaker = source === 'model' ? 'model' : 'app';
    if (this.turn?.reported && this.turn.id === turn) return;
    const current = this.turn && this.turn.id === turn ? this.turn : null;
    const tookSay = current?.tookSay ?? false;
    if (speaker === 'app' && !tookSay) this.due.shift();
    if (speaker === 'model' && tookSay) this.due.unshift(this.now() + 4000);
    this.turn = { id: turn, speaker, tookSay: speaker === 'app', reported: true };
  }

  // Who said a final assistant transcript, and which signal decided it.
  attribute(transcript: string): { speaker: Speaker; by: 'speech' | 'words' } {
    if (this.turn?.speaker === 'app') return { speaker: 'app', by: 'speech' };
    const said = wordsOf(transcript).filter((word) => !IGNORED.has(word) && !/\d/.test(word));
    if (this.recent.some((words) => said.filter((word) => !words.has(word)).length <= Math.floor(said.length / 10))) return { speaker: 'app', by: 'words' };
    return { speaker: 'model', by: this.turn ? 'speech' : 'words' };
  }
}
