import { appLinkOf, onAppLink, openAppLink } from '../appLinks';
import { redirectSystemPath } from '@/app/+native-intent';

describe('widget, Siri and Shortcuts links', () => {
  it('knows the three routes in either scheme, and in the forms the router passes them', () => {
    expect(appLinkOf('juno://feed')).toBe('feed');
    expect(appLinkOf('juno://agent')).toBe('agent');
    expect(appLinkOf('juno://post')).toBe('post');
    expect(appLinkOf('consumerhack://post/')).toBe('post');
    expect(appLinkOf('juno:///agent')).toBe('agent');
    expect(appLinkOf('/feed')).toBe('feed');
    expect(appLinkOf('JUNO://Feed')).toBe('feed');
  });

  it('ignores every parameter, so no link can carry text to publish or a post to like or delete', () => {
    expect(appLinkOf('juno://post?text=hello&confirm=yes')).toBe('post');
    expect(appLinkOf('juno://feed?like=at://did:plc:x/app.bsky.feed.post/1#now')).toBe('feed');
    expect(appLinkOf('juno://agent#delete')).toBe('agent');
  });

  it('leaves other paths alone, including deeper paths under a route', () => {
    expect(appLinkOf('juno://post/publish')).toBeNull();
    expect(appLinkOf('juno://like')).toBeNull();
    expect(appLinkOf('juno://sign-in')).toBeNull();
    expect(appLinkOf('/')).toBeNull();
    expect(appLinkOf('exp+consumerhack://expo-development-client/?url=x')).toBeNull();
  });

  it('holds a link that arrives before the feed is on screen (cold start), and passes a later one straight on (warm)', () => {
    openAppLink('agent');
    const heard: string[] = [];
    const off = onAppLink((link) => heard.push(link));
    expect(heard).toEqual(['agent']);
    openAppLink('feed');
    expect(heard).toEqual(['agent', 'feed']);
    off();
    openAppLink('post');
    expect(heard).toEqual(['agent', 'feed']);
    onAppLink((link) => heard.push(link))();
    expect(heard).toEqual(['agent', 'feed', 'post']);
  });

  it('routes each link to the feed screen, cold and warm, and passes other paths through', () => {
    const heard: string[] = [];
    for (const initial of [true, false]) {
      expect(redirectSystemPath({ path: 'juno://feed?x=1', initial })).toBe('/');
      expect(redirectSystemPath({ path: 'juno://agent', initial })).toBe('/');
      expect(redirectSystemPath({ path: 'juno://post?text=hi', initial })).toBe('/');
      const off = onAppLink((link) => heard.push(link));
      off();
    }
    expect(heard).toEqual(['post', 'post']);
    expect(redirectSystemPath({ path: '/sign-in', initial: false })).toBe('/sign-in');
  });
});
