import { isDevAgentLink, requestDevWake } from '@/agent/devWake';
import { appLinkOf, openAppLink } from '@/links/appLinks';

// Incoming links pass through here before routing. The widget, Siri and Shortcuts links (see
// src/links/appLinks.ts) open the feed screen and tell it what to do; the development link wakes the agent.
// Every other path is left alone.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const link = appLinkOf(path);
  if (link) {
    openAppLink(link);
    return '/';
  }
  if (!isDevAgentLink(path)) return path;
  requestDevWake();
  return '/';
}
