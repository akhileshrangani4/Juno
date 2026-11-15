export type Memory = { id: string; text: string };

export interface MemoryClient {
  list(): Promise<Memory[]>;
  remember(fact: string): Promise<Memory>;
  forget(ids: string[]): Promise<Memory[]>;
  // What this phone saved while signed out, and moving it to the signed-in account.
  savedSignedOut(): Promise<Memory[]>;
  carryOver(): Promise<{ carried: number; left: number }>;
}

// The user's memory can't be reached on this call: no proof of the account could be had or it was refused
// (offline, an older sign-in without the memory permission, a server that doesn't issue proofs).
export class MemoryUnavailableError extends Error {}

const CREDENTIAL = /\b(password|passcode|app password|pin code|token|secret|[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/i;
export const MAX_FACT_LENGTH = 280;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function sharesRun(a: string, b: string, run: number): boolean {
  const left = words(a);
  const right = ` ${words(b).join(' ')} `;
  for (let i = 0; i + run <= left.length; i++) {
    if (right.includes(` ${left.slice(i, i + run).join(' ')} `)) return true;
  }
  return false;
}

// What may be stored: something the user said about themselves. Checked on the phone before anything is sent.
export function memoryRejection(fact: string, othersText: string | null): string | null {
  const text = fact.trim();
  if (!text) return 'empty';
  if (text.length > MAX_FACT_LENGTH) return 'tooLong';
  if (CREDENTIAL.test(text)) return 'credential';
  if (othersText && sharesRun(text, othersText, 5)) return 'othersContent';
  return null;
}
