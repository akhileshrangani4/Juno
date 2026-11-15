// The links the widget, Siri and Shortcuts open: juno://feed, juno://agent and juno://post (the older
// consumerhack:// scheme works too). A link only chooses where the app opens. Everything after the route
// name is ignored, so no link can publish, like or delete anything.

export type AppLink = 'feed' | 'agent' | 'post';

const ROUTES: readonly AppLink[] = ['feed', 'agent', 'post'];

export function appLinkOf(path: string): AppLink | null {
  const route = path
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')
    .toLowerCase();
  return (ROUTES as readonly string[]).includes(route) ? (route as AppLink) : null;
}

let pending: AppLink | null = null;
let listener: ((link: AppLink) => void) | null = null;

// A link that arrives before the feed is on screen (a cold start, or while signing in) waits for it.
export function openAppLink(link: AppLink): void {
  if (listener) listener(link);
  else pending = link;
}

export function onAppLink(next: (link: AppLink) => void): () => void {
  listener = next;
  if (pending) {
    const link = pending;
    pending = null;
    next(link);
  }
  return () => {
    if (listener === next) listener = null;
  };
}
