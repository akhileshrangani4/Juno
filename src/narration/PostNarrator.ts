import type { Post } from '@/social/types';

import { buildPostScript, lateDescription, needsDescription, postEarcon, type NarrationMode } from './buildNarration';
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
    const parts = usesDescriptions ? descriptions.peek(post, detail) : null;
    const now = this.deps.now?.() ?? new Date();
    const script = [prefix, buildPostScript(post, { now, mode: effective, parts, skipHashtags: prefs.skipHashtags })].filter(Boolean).join(' ');
    this.publish(script);

    narrator.setRate(prefs.rate);
    const earcon = prefs.earcons && effective !== 'verbatim' ? postEarcon(post) : null;
    const lead = earcon ? earcons.play(earcon) : 0;
    if (lead > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        narrator.speak(this.script);
      }, lead);
    } else narrator.speak(script);

    if (usesDescriptions && !parts && needsDescription(post)) {
      descriptions.request(post, detail).then((fetched) => {
        if (!fetched || session !== this.session) return;
        const late = lateDescription(post, fetched);
        if (!late) return;
        this.publish(`${this.script} ${late}`);
        if (!this.timer) narrator.append(late);
      });
    }
    return script;
  }

  prefetch(upcoming: Post[]): void {
    const prefs = this.deps.preferences.get();
    if (prefs.mode === 'brief') return;
    this.deps.descriptions.prefetch(upcoming.slice(0, UPCOMING), prefs.detail);
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
