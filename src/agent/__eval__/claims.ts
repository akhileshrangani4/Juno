// Whether the agent's own words claim something happened that the app never reported: a send, a delete or removal,
// or a like. Checked clause by clause, so a negation or a condition in one clause doesn't excuse a claim in another.

export type Reported = { sent: boolean; undone: boolean; liked: boolean };

const SENT = /\b(?:posted|published|sent|reposted|replied|shared|went out|gone out|being sent|on its way|it'?s (?:up|live)|is (?:up|live)|(?:all )?done)\b/i;
const REMOVED = /\b(?:deleted|removed|undone|undid)\b/i;
const LIKED = /\b(?:liked|gave it a like|added a like)\b/i;
// A clause that denies or only anticipates is not a claim: "it's not sent yet", "once it's posted", "I'll post it".
const NOT_A_CLAIM = /\b(?:not|no|never|nothing|yet|once|when|if|after|until|before|will|going to|about to|shall|should|want|would|ready)\b|n['’]t\b|['’]ll\b|\?/i;

const clauses = (text: string) => text.split(/[.!;,:\n]+|\s+(?:but|and|so)\s+/i).filter((clause) => clause.trim());

export function unreportedClaims(said: string, reported: Reported): string[] {
  return clauses(said).filter((clause) => {
    if (NOT_A_CLAIM.test(clause)) return false;
    if (LIKED.test(clause) && !reported.liked) return true;
    if (REMOVED.test(clause)) return !reported.undone && !reported.sent;
    return SENT.test(clause) && !reported.sent;
  });
}
