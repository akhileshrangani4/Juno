import { isDevAgentLink, requestDevWake } from '@/agent/devWake';

// Incoming links pass through here before routing. Only the development link that wakes the agent is
// handled; every other path is left alone.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (!isDevAgentLink(path)) return path;
  requestDevWake();
  return '/';
}
