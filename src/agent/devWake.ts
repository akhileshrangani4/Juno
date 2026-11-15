// Development and test builds only: lets a cloud phone (which cannot draw a circle) wake the agent with
// the deep link consumerhack://dev-agent. EXPO_PUBLIC_DEV_AGENT_LINK is inlined at build time, so in a build
// without it every branch below is dead code and the link does nothing.

let pending = false;
let listener: (() => void) | null = null;

export function isDevAgentLink(path: string): boolean {
  return process.env.EXPO_PUBLIC_DEV_AGENT_LINK === '1' && /(^|[/:])dev-agent\b/.test(path);
}

export function requestDevWake(): void {
  if (process.env.EXPO_PUBLIC_DEV_AGENT_LINK !== '1') return;
  if (listener) listener();
  else pending = true;
}

export function onDevWake(next: () => void): () => void {
  if (process.env.EXPO_PUBLIC_DEV_AGENT_LINK !== '1') return () => undefined;
  listener = next;
  if (pending) {
    pending = false;
    next();
  }
  return () => {
    if (listener === next) listener = null;
  };
}
