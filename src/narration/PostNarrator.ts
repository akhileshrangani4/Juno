import type { Post } from '@/social/types';

import {
  buildPostScript,
  cannotPronounce,
  lateAddition,
  needsDescription,
  postEarcon,
  translatedText,
  translationMessages,
  type DescriptionParts,
  type NarrationMode,
  type TranslationState,
} from './buildNarration';
import type { DescriptionCache } from './descriptions';
import type { EarconPlayer } from './earcons';
import type { Narrator } from './Narrator';
import type { PreferencesStore } from './preferences';

export type FocusOptions = { mode?: NarrationMode; prefix?: string };

type Deps = {
  narrator: Narrator;
  descriptions: DescriptionCache;
  earcons: EarconPlayer;
  preferences: PreferencesStore;
  now?: () => Date;
};

const UPCOMING = 3;

// Narrates the post in focus. Speech starts at once from whatever is known on the device; a description
// that arrives later is appended while the same post is still in focus, and only cached once the user has moved on.
export class PostNarrator {
  private session = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private script = '';
  private readonly listeners = new Set<(script: string) => void>();

  constructor(private readonly deps: Deps) {}

  focus(post: Post, { mode, prefix }: FocusOptions = {}): string {
    this.stop();
    const session = this.session;
    const { narrator, descriptions, earcons, preferences } = this.deps;
    const prefs = preferences.get();
    const effective = mode ?? prefs.mode;
    const detail = effective === 'detailedImage' ? 'detailed' : prefs.detail;
    const usesDescriptions = effective === 'full' || effective === 'detailedImage';
    const translates = effective === 'full' || effective === 'brief' || effective === 'verbatim';
    const parts = usesDescriptions || translates ? descriptions.peek(post, detail) : null;
    const translation = translates ? descriptions.translationState(post, detail) : null;
    const now = this.deps.now?.() ?? new Date();
    const { body, language } = this.reading(post, effective, parts, translation, now);
    const script = [prefix, body].filter(Boolean).join(' ');
    this.publish(script);

    narrator.setRate(prefs.rate);
    const earcon = prefs.earcons && effective !== 'verbatim' ? postEarcon(post) : null;
    const lead = earcon ? earcons.play(earcon) : 0;
    const say = (text: string) => (language ? narrator.speak(text, { language }) : narrator.speak(text));
    if (lead > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        say(this.script);
      }, lead);
    } else say(script);

    if (!parts && ((usesDescriptions && needsDescription(post)) || translation === 'pending')) {
      descriptions.request(post, detail, { translationOnly: !usesDescriptions }).then((fetched) => {
        if (session !== this.session) return;
        const late = fetched
          ? lateAddition(post, fetched, translation, { brief: effective === 'brief', media: usesDescriptions })
          : translation === 'pending'
            ? translationMessages.failed
            : null;
        if (!late) return;
        this.publish(`${this.script} ${late}`);
        if (!this.timer) narrator.append(late);
      });
    }
    return script;
  }

  // The script for a post, and the voice to read it in. A post in another language is read exactly in its own
  // language's voice when one is installed, and otherwise as its labeled translation, never in the wrong voice.
  private reading(post: Post, mode: NarrationMode, parts: DescriptionParts | null, translation: TranslationState, now: Date): { body: string; language?: string } {
    const { narrator, preferences } = this.deps;
    const foreign = parts?.translation?.language ?? parts?.untranslatedLanguage;
    if (mode === 'verbatim' && foreign) {
      if (narrator.canSpeak?.(foreign)) return { body: buildPostScript(post, { now, mode }), language: foreign };
      const translated = translatedText(parts?.translation);
      return { body: translated ? `${cannotPronounce(foreign)} ${translated}` : translationMessages.failedIn(foreign) };
    }
    if (mode === 'verbatim' && translation) return { body: translationMessages[translation] };
    return { body: buildPostScript(post, { now, mode, parts, skipHashtags: preferences.get().skipHashtags, translation }) };
  }

  prefetch(upcoming: Post[]): void {
    const prefs = this.deps.preferences.get();
    this.deps.descriptions.prefetch(upcoming.slice(0, UPCOMING), prefs.detail, { translationOnly: prefs.mode === 'brief' });
  }

  stop(): void {
    this.session += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deps.narrator.stop();
  }

  speaking(): boolean {
    return this.timer !== null || this.deps.narrator.speaking();
  }

  onScript(listener: (script: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private publish(script: string) {
    this.script = script;
    this.listeners.forEach((listener) => listener(script));
  }
}
