// Which posts may need translating, decided without a network or a model. Shared by the app and the Convex
// action (convex/describe.ts), so both reach the same answer for the same post. It is deliberately
// conservative: a post too short to tell, or one that looks like it is in a language the user reads, is read as
// it is. The model has the last word on a candidate (convex/describeCache.ts).

export type Languages = { target: string; keep: string[] };

const NAMES: Record<string, string> = {
  af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', az: 'Azerbaijani', be: 'Belarusian', bg: 'Bulgarian', bn: 'Bengali', bs: 'Bosnian',
  ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German', el: 'Greek', en: 'English', eo: 'Esperanto', es: 'Spanish',
  et: 'Estonian', eu: 'Basque', fa: 'Persian', fi: 'Finnish', fil: 'Filipino', fr: 'French', ga: 'Irish', gl: 'Galician', gu: 'Gujarati',
  he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian', hy: 'Armenian', id: 'Indonesian', is: 'Icelandic', it: 'Italian',
  ja: 'Japanese', ka: 'Georgian', kk: 'Kazakh', km: 'Khmer', kn: 'Kannada', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian',
  mk: 'Macedonian', ml: 'Malayalam', mn: 'Mongolian', mr: 'Marathi', ms: 'Malay', my: 'Burmese', nb: 'Norwegian', ne: 'Nepali',
  nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', si: 'Sinhala',
  sk: 'Slovak', sl: 'Slovenian', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', te: 'Telugu', th: 'Thai',
  tl: 'Tagalog', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', yi: 'Yiddish', zh: 'Chinese', zu: 'Zulu',
};

const CODE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;

export const isLanguageCode = (code: string) => code.length <= 35 && CODE.test(code);

// Comparisons use the primary subtag: a user who reads "pt-BR" reads a post declared "pt".
export const primary = (code: string) => code.toLowerCase().split('-')[0];

export const languageName = (code: string) => NAMES[primary(code)] ?? 'another language';

// "Spanish", "spanish", "es" or "es-MX" to "es"; anything else to null.
export function languageCode(nameOrCode: string): string | null {
  const value = nameOrCode.trim().toLowerCase();
  if (isLanguageCode(value) && NAMES[primary(value)]) return primary(value);
  return Object.entries(NAMES).find(([, name]) => name.toLowerCase() === value)?.[0] ?? null;
}

export const reads = (languages: Languages, code: string) => languages.keep.some((kept) => primary(kept) === primary(code));

// One cache key per target and set of kept languages, so two users who would get different answers never share one.
export const languagesKey = (languages: Languages | null) =>
  languages ? `${primary(languages.target)}>${[...new Set(languages.keep.map(primary))].sort().join(',')}` : '';

type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'devanagari' | 'han' | 'kana' | 'hangul' | 'thai' | 'other';

const SCRIPTS: [Script, RegExp][] = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['han', /\p{Script=Han}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['thai', /\p{Script=Thai}/u],
];

const LANGUAGE_SCRIPTS: Record<string, Script[]> = {
  ru: ['cyrillic'], uk: ['cyrillic'], bg: ['cyrillic'], be: ['cyrillic'], sr: ['cyrillic', 'latin'], mk: ['cyrillic'], kk: ['cyrillic'], mn: ['cyrillic'],
  el: ['greek'], ar: ['arabic'], fa: ['arabic'], ur: ['arabic'], he: ['hebrew'], yi: ['hebrew'], hi: ['devanagari'], mr: ['devanagari'], ne: ['devanagari'],
  ja: ['kana', 'han'], zh: ['han'], ko: ['hangul', 'han'], th: ['thai'],
  am: ['other'], hy: ['other'], ka: ['other'], bn: ['other'], gu: ['other'], pa: ['other'], ta: ['other'], te: ['other'], kn: ['other'], ml: ['other'], si: ['other'], km: ['other'], my: ['other'],
};

const scriptsOf = (code: string): Script[] => LANGUAGE_SCRIPTS[primary(code)] ?? ['latin'];

// Common short words that, taken together, give away a Latin-script language.
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'was', 'with', 'this', 'that', 'you', 'have', 'for', 'not', 'what', 'just', 'it', 'my', 'of', 'to', 'be', 'we', 'they', 'he', 'she', 'i', 'a', 'in', 'on', 'so', 'like', 'but', 'all', 'your', 'me', 'at', 'if', 'do', 'get', 'when', 'how'],
  es: ['el', 'los', 'las', 'del', 'que', 'y', 'es', 'por', 'para', 'con', 'una', 'pero', 'más', 'muy', 'esto', 'esta', 'está', 'como', 'hoy', 'todo', 'yo', 'mi', 'lo'],
  fr: ['le', 'les', 'des', 'est', 'et', 'une', 'avec', 'pour', 'pas', 'qui', 'dans', 'sur', 'je', 'nous', 'vous', 'mais', 'très', 'cette', 'ce', 'au', 'du', "c'est"],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'ich', 'wir', 'auf', 'für', 'auch', 'sich', 'dem', 'den', 'aber', 'noch', 'zu', 'von'],
  pt: ['o', 'os', 'as', 'que', 'não', 'com', 'uma', 'para', 'mais', 'muito', 'isso', 'está', 'você', 'eu', 'do', 'da', 'dos', 'das', 'mas', 'é', 'em'],
  it: ['il', 'gli', 'che', 'è', 'non', 'con', 'una', 'per', 'più', 'molto', 'sono', 'questo', 'questa', 'anche', 'della', 'ho', 'io', 'ma', 'di', 'nel', 'alla'],
  nl: ['het', 'een', 'niet', 'met', 'ik', 'wij', 'dat', 'van', 'voor', 'ook', 'maar', 'zijn', 'naar', 'heb', 'deze', 'wel'],
  tr: ['ve', 'bir', 'bu', 'için', 'çok', 'ben', 'sen', 'ama', 'gibi', 'daha', 'var', 'yok', 'olan', 'değil'],
  pl: ['nie', 'się', 'jest', 'że', 'jak', 'ale', 'tak', 'już', 'mnie', 'jestem', 'tylko', 'dla', 'czy', 'jeszcze'],
  id: ['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'ada', 'saya', 'aku', 'kita', 'dari', 'akan', 'juga', 'sudah'],
};

// A post needs this many letters (CJK characters count double) before its language is judged at all.
export const MIN_LETTERS = 12;
// Fewer Latin-script words than this are not translated on a declaration alone.
const MIN_DECLARED_WORDS = 4;

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export type TranslationCheck = { candidate: boolean; reason: string };

// Whether a post's text may be in a language the user does not read. A candidate makes a model call, which
// detects the language and translates only when it really is foreign; anything else is read as it is.
export function translationCheck(body: string, declared: string[], languages: Languages | null): TranslationCheck {
  if (!languages) return { candidate: false, reason: 'translation off' };
  const letters = [...body].filter((char) => /\p{L}/u.test(char));
  const weight = letters.reduce((sum, char) => sum + (WIDE.test(char) ? 2 : 1), 0);
  if (weight < MIN_LETTERS) return { candidate: false, reason: 'too short to tell' };

  const counts = new Map<Script, number>();
  for (const char of letters) {
    const script = SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ?? 'other';
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  const kana = counts.get('kana') ?? 0;
  if (kana) {
    counts.set('kana', kana + (counts.get('han') ?? 0));
    counts.delete('han');
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const keptScripts = new Set(languages.keep.flatMap(scriptsOf));
  if (!keptScripts.has(dominant)) return { candidate: true, reason: 'written in a script the user does not read' };
  if (dominant !== 'latin') {
    const declaredOther = declared.length > 0 && declared.every((code) => !reads(languages, code) && scriptsOf(code).includes(dominant));
    return declaredOther ? { candidate: true, reason: 'declared in a language the user does not read' } : { candidate: false, reason: 'written in a script the user reads' };
  }

  // The text overrules a declaration only on stronger evidence than it takes with no declaration, so a few short
  // words shared between languages never flip a post either way.
  const declaredOther = declared.length > 0 && declared.every((code) => !reads(languages, code));
  const guess = guessLatin(body, declared.length ? 3 : 2);
  if (guess) return reads(languages, guess) ? { candidate: false, reason: 'looks like a language the user reads' } : { candidate: true, reason: 'looks like a language the user does not read' };
  if (!declaredOther) return { candidate: false, reason: 'no sign of another language' };
  // A declaration alone is weak evidence for a few Latin-script words ("Silver sketch" declared Portuguese).
  const words = body.match(/[\p{L}']+/gu) ?? [];
  return words.length < MIN_DECLARED_WORDS ? { candidate: false, reason: 'too short to tell' } : { candidate: true, reason: 'declared in a language the user does not read' };
}

// The Latin-script language whose common words appear most, when it has at least `least` of them and twice
// as many as any other.
export function guessLatin(body: string, least = 2): string | null {
  const words = body.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const scores = Object.entries(STOPWORDS)
    .map(([code, list]) => [code, words.filter((word) => list.includes(word)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= least && best[1] >= 2 * second[1] ? best[0] : null;
}
