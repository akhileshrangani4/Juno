import { makePost } from '@/testing/fixtures';

import { messages } from '../buildNarration';
import { narrationPreferences } from '../postNarration';
import { applyNarrationAction, getNarrationPreferences, narratePost, narrationActions, setSkipHashtags } from '../requests';

jest.mock('../earcons', () => ({ createEarconPlayer: () => ({ play: () => 0 }) }));

describe('narration requests', () => {
  beforeEach(() => narrationPreferences.update({ mode: 'full', rate: 1, earcons: true, skipHashtags: false, detail: 'standard' }));

  it('does nothing when no feed is on screen', () => {
    expect(narratePost(makePost(), 'verbatim')).toBeNull();
  });

  it('labels the VoiceOver actions by what they will do', () => {
    expect(narrationActions(getNarrationPreferences(), false).map((action) => action.label)).toEqual(['Brief narration', 'Speak faster', 'Speak slower', 'Turn post sounds off']);
    narrationPreferences.update({ mode: 'brief', earcons: false });
    expect(narrationActions(getNarrationPreferences(), false).map((action) => action.label)).toEqual(['Full narration', 'Speak faster', 'Speak slower', 'Turn post sounds on']);
  });

  it("offers no speed steps under a screen reader, and says that the screen reader's own rate applies", () => {
    expect(narrationActions(getNarrationPreferences(), true).map((action) => action.label)).toEqual(['Brief narration', 'Speech speed', 'Turn post sounds off']);
    expect(applyNarrationAction('speechRate', true)).toBe(messages.screenReaderRate);
    expect(applyNarrationAction('faster', true)).toBe(messages.screenReaderRate);
    expect(applyNarrationAction('slower', true)).toBe(messages.screenReaderRate);
    expect(getNarrationPreferences().rate).toBe(1);
  });

  it('switches mode and sounds and says so', () => {
    expect(applyNarrationAction('narrationMode', false)).toBe('Brief narration.');
    expect(getNarrationPreferences().mode).toBe('brief');
    expect(applyNarrationAction('narrationMode', false)).toBe('Full narration.');
    expect(applyNarrationAction('earcons', false)).toBe('Post sounds off.');
    expect(getNarrationPreferences().earcons).toBe(false);
  });

  it('changes the speech rate up to three times normal and says when it cannot go further', () => {
    expect(applyNarrationAction('faster', false)).toBe('Speed 1.25 times normal.');
    narrationPreferences.update({ rate: 2.75 });
    expect(applyNarrationAction('faster', false)).toBe('Speed 3 times normal.');
    expect(applyNarrationAction('faster', false)).toBe('Already at the fastest speed, 3 times normal.');
    narrationPreferences.update({ rate: 0.5 });
    expect(applyNarrationAction('slower', false)).toBe('Already at the slowest speed, 0.5 times normal.');
  });

  it('stores standing preferences for the agent', () => {
    setSkipHashtags(true);
    expect(getNarrationPreferences().skipHashtags).toBe(true);
  });
});
