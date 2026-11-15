// What a memory proof is for. The app asks the user's Bluesky server for a service-auth token with this audience
// and method (src/agent/memoryAccess.ts), and convex/memoryAuth.ts accepts nothing else. The method is Juno's own,
// so a token for it opens nothing anywhere else, and the audience names this deployment.

export const MEMORY_METHOD = 'com.akhileshrangani.juno.accessMemory';

const MEMORY_SERVICE = 'juno_memory';

export function memoryAudience(siteUrl: string): string {
  return `did:web:${new URL(siteUrl).hostname}#${MEMORY_SERVICE}`;
}

// The app knows the deployment by its .convex.cloud URL; the audience uses its .convex.site twin, which is what
// the deployment itself sees as CONVEX_SITE_URL.
export function convexSiteUrl(cloudUrl: string): string {
  const url = new URL(cloudUrl);
  url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
  return url.origin;
}
