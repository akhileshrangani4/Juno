import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_OAUTH_ORIGIN } from '@/social/bluesky/BlueskyProvider';

import { MEMORY_METHOD, convexSiteUrl, memoryAudience } from '../../../convex/memoryService';
import { OAUTH_CLIENT_METADATA_PATH, oauthClientMetadata } from '../../../convex/oauthClientMetadata';

// Three things must name the same memory audience, or every OAuth user's memory fails with "sign in again":
// the scope in the client metadata the OAuth client id points at (granted at sign-in), the audience the app asks
// its PDS to sign proofs for (src/agent/convexMemory.ts, from the deployment's .convex.cloud URL), and the audience
// the deployment accepts (convex/memory.ts, from its CONVEX_SITE_URL, the .convex.site twin of that URL). The client
// id and the Convex URL are configured separately, so moving the client id (AKH-24) or pointing a build at another
// deployment must keep them in step; this fails if they drift.

const BUILD_SCRIPT = readFileSync(join(__dirname, '../../../scripts/build-ios-simulator.sh'), 'utf8');

// What a build uses: the environment's value, else the default the app or the build script falls back to.
const oauthOrigin = process.env.EXPO_PUBLIC_BLUESKY_OAUTH_ORIGIN || DEFAULT_OAUTH_ORIGIN;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || BUILD_SCRIPT.match(/EXPO_PUBLIC_CONVEX_URL:-([^}"]+)/)?.[1];

function audiences(clientOrigin: string, cloudUrl: string) {
  const metadata = oauthClientMetadata(clientOrigin);
  const scope = metadata.scope.split(' ').find((entry) => entry.startsWith(`rpc:${MEMORY_METHOD}?aud=`));
  return {
    clientId: metadata.client_id,
    granted: scope ? decodeURIComponent(scope.slice(`rpc:${MEMORY_METHOD}?aud=`.length)) : null,
    proof: memoryAudience(convexSiteUrl(cloudUrl)),
  };
}

describe('memory audience', () => {
  it('is the same in the granted OAuth scope as in the proof the app asks for and the deployment accepts', () => {
    expect(convexUrl).toMatch(/^https:\/\/[a-z0-9-]+\.convex\.cloud$/);
    const found = audiences(oauthOrigin, convexUrl!);
    expect(found.clientId).toBe(`${new URL(oauthOrigin).origin}${OAUTH_CLIENT_METADATA_PATH}`);
    expect(found.granted).toBe(found.proof);
    expect(found.proof).toBe(memoryAudience(`https://${new URL(convexUrl!).hostname.replace('.convex.cloud', '.convex.site')}`));
  });

  it('notices a client id served from somewhere other than the memory deployment', () => {
    const found = audiences('https://juno.example.com', convexUrl!);
    expect(found.granted).not.toBe(found.proof);
  });
});
