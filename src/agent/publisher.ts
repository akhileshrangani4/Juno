import { countGraphemes } from 'unicode-segmenter/grapheme';

import { analyzeText, authorName, formatAge, tagList } from '@/narration/buildNarration';
import type { Post } from '@/social/types';

// Publishing by voice, enforced here rather than in the prompt:
// 1. A draft step builds exactly what will be published and to whom; the app reads it aloud itself.
// 2. Publishing is accepted only for that draft, and only when the user's very next utterance after the read-back
//    is a plain yes and nothing else. A later turn, or any other tool call in between, needs a new read-back.
// 3. After the yes, nothing is sent for UNDO_WINDOW_MS; undo in that window cancels it with nothing sent.
// 4. An undo while the send is in flight is held for that send: whatever went out is removed when it returns.

export const POST_LIMIT = 300;
export const UNDO_WINDOW_MS = 5000;

export type DraftKind = 'post' | 'reply' | 'repost' | 'delete';

// A photo attached to a new post, with the alt text other people's screen readers will speak.
// uri identifies the photo: each kept or chosen photo is a new file, so a draft is bound to exactly one photo.
export type DraftImage = { uri: string; mimeType: string; alt: string; width?: number; height?: number };

export type Draft = {
  id: string;
  kind: DraftKind;
  text: string;
  parts: string[];
  split: boolean;
  target: Post | null;
  image?: DraftImage | null;
  readBackTurn: number | null;
  voided?: boolean;
};

export type DraftOutcome =
  | { ok: true; draft: Draft; readBack: string }
  | { ok: false; reason: 'tooLong'; draft: Draft; graphemes: number; parts: number }
  | { ok: false; reason: 'empty' | 'noDraft' | 'notFound' | 'notSplittable' };

export type ConfirmOutcome =
  | { ok: true; draft: Draft; announcement: string }
  | { ok: false; reason: 'noDraft' | 'staleDraft' | 'notReadBack' | 'sameTurn' | 'notAffirmative' | 'alreadyPending' }
  | { ok: false; reason: 'expired' | 'wrongVerb'; readBack: string };

// stopped: cancelled inside the five seconds, nothing sent. sending: the send is in flight and removes what it sent.
export type UndoOutcome = { state: 'stopped' | 'sending'; draft: Draft } | null;

type Deps = {
  // undoRequested turns true when the user says undo while this send is in flight.
  send(draft: Draft, undoRequested: () => boolean): Promise<void>;
  schedule(run: () => void, ms: number): () => void;
  newId(): string;
  now?: () => Date;
};

export const graphemeLength = (text: string) => countGraphemes(text);

// A confirmation is an utterance made only of assent: "yes", "yes please", "yeah post it", "go ahead and send it".
// Anything more ("sure, but change…", "okay let me think"), a question, or a hedge is not a yes.
const VERB = '(?:post|send|share|publish|reply|repost|delete|remove)';
const ASSENT = `(?:yes|yeah|yep|yup|yea|sure|ok|okay|absolutely|definitely|correct|confirm|please|go ahead|do it|that'?s right|sounds good|${VERB}(?: (?:it|that|this|the (?:post|reply)))?)`;
const CONFIRMATION = new RegExp(`^${ASSENT}(?: (?:and )?${ASSENT})*$`);

// A bare assent confirms whatever was read back; a verb has to fit it, so "yes, delete it" never sends a post.
const FITTING_VERBS: Record<DraftKind, string[]> = {
  post: ['post', 'send', 'share', 'publish'],
  reply: ['post', 'send', 'share', 'publish', 'reply'],
  repost: ['post', 'send', 'share', 'publish', 'repost'],
  delete: ['delete', 'remove'],
};

// The verbs in an utterance made only of assent, or null when it is anything more than assent.
function assentVerbs(utterance: string): string[] | null {
  if (utterance.includes('?')) return null;
  const said = utterance
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!CONFIRMATION.test(said) || /^(?:please ?)+$/.test(said)) return null;
  return said.match(new RegExp(`\\b${VERB}\\b`, 'g')) ?? [];
}

export function isAffirmative(utterance: string, kind?: DraftKind): boolean {
  const verbs = assentVerbs(utterance);
  return verbs !== null && (!kind || verbs.every((verb) => FITTING_VERBS[kind].includes(verb)));
}

function pack(units: string[], limit: number, joiner: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (graphemeLength(candidate) <= limit) current = candidate;
    else {
      if (current) parts.push(current);
      current = unit;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function splitIntoParts(text: string, limit = POST_LIMIT): string[] {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  const units = sentences.flatMap((sentence) => {
    if (graphemeLength(sentence) <= limit) return [sentence];
    return pack(sentence.split(/\s+/), limit, ' ').flatMap((chunk) => {
      if (graphemeLength(chunk) <= limit) return [chunk];
      const pieces: string[] = [];
      let rest = [...chunk];
      while (rest.length) {
        pieces.push(rest.slice(0, limit).join(''));
        rest = rest.slice(limit);
      }
      return pieces;
    });
  });
  return pack(units, limit, ' ');
}

// What follows "Sam's post" in a read-back: its first words, its tags when it has only tags, or nothing.
export function snippetOf(post: Post, words = 12): string {
  const { body, allTags } = analyzeText(post);
  const spoken = body.split(/\s+/).filter(Boolean);
  if (spoken.length) return `that starts "${spoken.slice(0, words).join(' ')}${spoken.length > words ? '…' : ''}"`;
  return allTags.length ? `tagged ${tagList(allTags)}` : '';
}

const postName = (target: Post | null) => (target ? [`${authorName(target)}'s post`, snippetOf(target)].filter(Boolean).join(' ') : 'this post');

const VERBS: Record<DraftKind, { doing: string; question: string }> = {
  post: { doing: 'Posting', question: 'Shall I post it?' },
  reply: { doing: 'Replying', question: 'Shall I send the reply?' },
  repost: { doing: 'Reposting', question: 'Shall I repost it?' },
  delete: { doing: 'Deleting', question: 'Shall I delete it?' },
};

const asSentence = (text: string) => (/[.!?…]['")\]]*$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// The alt text is read back in full, because it is what other blind people will hear for this picture.
function imageLine(image: DraftImage): string {
  return image.alt.trim() ? `With the image description: ${asSentence(image.alt)}` : 'The image has no description yet. You can tell me what it should say.';
}

export function readBackOf(draft: Draft, now = new Date()): string {
  const { question } = VERBS[draft.kind];
  const body =
    draft.parts.length > 1
      ? `This will be a thread of ${draft.parts.length} posts. ${draft.parts.map((part, i) => `Post ${i + 1}: ${asSentence(part)}`).join(' ')}`
      : asSentence(draft.text);
  const target = draft.target;
  switch (draft.kind) {
    case 'post':
      if (draft.image && !draft.text) return `Posting a photo with no text to your followers. ${imageLine(draft.image)} ${question}`;
      return draft.image ? `Posting to your followers: ${body} ${imageLine(draft.image)} ${question}` : `Posting to your followers: ${body} ${question}`;
    case 'reply':
      return `Replying to ${postName(target)}: ${body} ${question}`;
    case 'repost':
      return `Reposting ${postName(target)} to your followers. ${question}`;
    case 'delete':
      return `Deleting your post from ${target ? formatAge(target.createdAt, now) : 'earlier'}: ${asSentence(target?.text || 'a post with no text')} A deleted post can't be brought back. ${question}`;
  }
}

export function announcementOf(draft: Draft): string {
  return `${VERBS[draft.kind].doing} in five seconds. Say undo to stop it.`;
}

export class Publisher {
  private draft: Draft | null = null;
  private pending: { draft: Draft; cancel: (() => void) | null } | null = null;
  private sending: { draft: Draft; undoRequested: boolean } | null = null;

  constructor(private readonly deps: Deps) {}

  get currentDraft(): Draft | null {
    return this.draft;
  }

  get pendingDraft(): Draft | null {
    return this.pending?.draft ?? null;
  }

  get sendingDraft(): Draft | null {
    return this.sending?.draft ?? null;
  }

  // Confirmed and not finished: counting down or being sent.
  get busy(): boolean {
    return this.pending !== null || this.sending !== null;
  }

  draftText(kind: 'post' | 'reply', text: string, target: Post | null, turn: number, image: DraftImage | null = null): DraftOutcome {
    const clean = text.trim();
    if (!clean && !image) return { ok: false, reason: 'empty' };
    return this.check({ id: this.deps.newId(), kind, text: clean, parts: [clean], split: false, target, image, readBackTurn: null }, turn);
  }

  // Changes the attached image's description: the whole of it (find null), or one phrase in it.
  editImageDescription(find: string | null, replace: string, turn: number): DraftOutcome {
    const draft = this.draft;
    if (!draft?.image) return { ok: false, reason: 'noDraft' };
    const alt = draft.image.alt;
    let next = replace.trim();
    if (find !== null) {
      const at = alt.toLowerCase().indexOf(find.trim().toLowerCase());
      if (!find.trim() || at < 0) return { ok: false, reason: 'notFound' };
      next = `${alt.slice(0, at)}${replace.trim()}${alt.slice(at + find.trim().length)}`.replace(/\s+/g, ' ').trim();
    }
    return this.check({ ...draft, id: this.deps.newId(), image: { ...draft.image, alt: next }, readBackTurn: null }, turn);
  }

  draftAction(kind: 'repost' | 'delete', target: Post, turn: number): DraftOutcome {
    return this.check({ id: this.deps.newId(), kind, text: '', parts: [], split: false, target, readBackTurn: null }, turn);
  }

  edit(find: string, replace: string, turn: number): DraftOutcome {
    const draft = this.draft;
    if (!draft || (draft.kind !== 'post' && draft.kind !== 'reply')) return { ok: false, reason: 'noDraft' };
    const at = draft.text.toLowerCase().indexOf(find.trim().toLowerCase());
    if (!find.trim() || at < 0) return { ok: false, reason: 'notFound' };
    const text = `${draft.text.slice(0, at)}${replace.trim()}${draft.text.slice(at + find.trim().length)}`.replace(/\s+/g, ' ').trim();
    if (!text && !draft.image) return { ok: false, reason: 'empty' };
    return this.check({ ...draft, id: this.deps.newId(), text, parts: draft.split ? splitIntoParts(text) : [text], readBackTurn: null }, turn);
  }

  split(turn: number): DraftOutcome {
    const draft = this.draft;
    if (!draft) return { ok: false, reason: 'noDraft' };
    if (draft.kind !== 'post' && draft.kind !== 'reply') return { ok: false, reason: 'notSplittable' };
    return this.check({ ...draft, id: this.deps.newId(), parts: splitIntoParts(draft.text), split: true, readBackTurn: null }, turn);
  }

  discard(): boolean {
    const had = this.draft !== null;
    this.draft = null;
    return had;
  }

  // Something other than answering the read-back happened (another tool call), so the next yes can't count.
  interrupt(): void {
    if (this.draft?.readBackTurn != null) this.draft.voided = true;
  }

  // The assistant said something of its own after the read-back and before the user answered, so the user's next
  // yes may be answering that instead.
  assistantSpoke(turn: number): boolean {
    if (this.draft?.readBackTurn !== turn || this.draft.voided) return false;
    this.draft.voided = true;
    return true;
  }

  // A draft was read back and its yes would still count.
  get awaitingAnswer(): boolean {
    return this.draft?.readBackTurn != null && !this.draft.voided;
  }

  // The user said something other than yes or undo while the send was counting down (for example the second half
  // of "Yes, … but change it"), so it goes back to being a draft and is read back again.
  hold(turn: number): { draft: Draft; readBack: string } | null {
    const draft = this.cancelPending();
    if (!draft) return null;
    this.draft = draft;
    return { draft, readBack: this.readBackAgain(draft, turn) };
  }

  confirm(draftId: string, turn: number, utterance: string): ConfirmOutcome {
    if (this.busy) return { ok: false, reason: 'alreadyPending' };
    const draft = this.draft;
    if (!draft) return { ok: false, reason: 'noDraft' };
    if (draft.id !== draftId) return { ok: false, reason: 'staleDraft' };
    if (draft.readBackTurn === null) return { ok: false, reason: 'notReadBack' };
    if (turn <= draft.readBackTurn) return { ok: false, reason: 'sameTurn' };
    if (draft.voided || turn > draft.readBackTurn + 1) return { ok: false, reason: 'expired', readBack: this.readBackAgain(draft, turn) };
    if (!isAffirmative(utterance)) return { ok: false, reason: 'notAffirmative' };
    if (!isAffirmative(utterance, draft.kind)) return { ok: false, reason: 'wrongVerb', readBack: this.readBackAgain(draft, turn) };
    this.draft = null;
    this.pending = { draft, cancel: null };
    return { ok: true, draft, announcement: announcementOf(draft) };
  }

  startCountdown(): void {
    const pending = this.pending;
    if (!pending || pending.cancel) return;
    pending.cancel = this.deps.schedule(() => {
      if (this.pending !== pending) return;
      this.pending = null;
      const sending = { draft: pending.draft, undoRequested: false };
      this.sending = sending;
      void this.deps
        .send(pending.draft, () => sending.undoRequested)
        .finally(() => {
          if (this.sending === sending) this.sending = null;
        });
    }, UNDO_WINDOW_MS);
  }

  // Undo always targets what the user just confirmed, whether it is counting down or already being sent.
  undo(): UndoOutcome {
    if (this.sending) {
      this.sending.undoRequested = true;
      return { state: 'sending', draft: this.sending.draft };
    }
    const draft = this.cancelPending();
    return draft ? { state: 'stopped', draft } : null;
  }

  // Cancels a send that is still counting down; a send already in flight finishes.
  cancelPending(): Draft | null {
    const pending = this.pending;
    if (!pending) return null;
    pending.cancel?.();
    this.pending = null;
    return pending.draft;
  }

  private readBackAgain(draft: Draft, turn: number): string {
    draft.voided = false;
    draft.readBackTurn = turn;
    return readBackOf(draft, this.deps.now?.() ?? new Date());
  }

  private check(draft: Draft, turn: number): DraftOutcome {
    this.draft = draft;
    const longest = Math.max(0, ...draft.parts.map(graphemeLength));
    if (longest > POST_LIMIT) {
      return { ok: false, reason: 'tooLong', draft, graphemes: graphemeLength(draft.text), parts: splitIntoParts(draft.text).length };
    }
    draft.readBackTurn = turn;
    draft.voided = false;
    return { ok: true, draft, readBack: readBackOf(draft, this.deps.now?.() ?? new Date()) };
  }
}
