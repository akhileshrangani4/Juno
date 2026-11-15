import { normalizeHandle, spellHandle } from '../handle';
import { authMessages } from '../messages';

describe('normalizeHandle', () => {
  it('adds the bsky.social domain to a bare name and says so', () => {
    expect(normalizeHandle('maya')).toEqual({ handle: 'maya.bsky.social', addedDomain: true });
    expect(authMessages.readBack('maya.bsky.social', true, true)).toBe("Did you mean maya dot bsky dot social? Double tap Continue if that's right.");
  });

  it('trims, lower-cases and drops a leading @', () => {
    expect(normalizeHandle('  @Maya.bsky.social ')).toEqual({ handle: 'maya.bsky.social', addedDomain: false });
    expect(authMessages.readBack('maya.bsky.social', false, true)).toBe("maya dot bsky dot social. Double tap Continue if that's right.");
  });

  it('turns a spoken dot between words into a period', () => {
    expect(normalizeHandle('maya dot example dot com')).toEqual({ handle: 'maya.example.com', addedDomain: false });
    expect(normalizeHandle('Maya Dot Example Dot Com')?.handle).toBe('maya.example.com');
  });

  it('accepts dictation that capitalizes and spaces the parts', () => {
    expect(normalizeHandle('Maya. Bsky. Social.')?.handle).toBe('maya.bsky.social');
  });

  it('keeps a handle on a custom domain as entered', () => {
    expect(normalizeHandle('news.juno-app.org')).toEqual({ handle: 'news.juno-app.org', addedDomain: false });
    expect(authMessages.readBack('news.juno-app.org', false, false)).toBe("news dot juno dash app dot org. Tap Continue if that's right.");
  });

  it('keeps a name that is the word dot', () => {
    expect(normalizeHandle('dot.bsky.social')?.handle).toBe('dot.bsky.social');
  });

  it('rejects empty and malformed entries', () => {
    expect(normalizeHandle('   ')).toBeNull();
    expect(normalizeHandle('@')).toBeNull();
    expect(normalizeHandle('maya!.bsky.social')).toBeNull();
    expect(normalizeHandle('maya..social')).toBeNull();
  });

  it('spells every part of a handle', () => {
    expect(spellHandle('jo-ann.example.co.uk')).toBe('jo dash ann dot example dot co dot uk');
  });
});
