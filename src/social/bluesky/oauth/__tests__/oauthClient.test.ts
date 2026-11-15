import { TokenRefreshError } from '@atproto/oauth-client';
import { p256 } from '@noble/curves/nist.js';

import { createMemoryStore } from '@/storage/keyValueStore';

import { createOAuthClient } from '../createOAuthClient';
import { fromBase64url } from '../NobleKey';
import { OAUTH_SESSION_KEY } from '../stores';

const randomBytes = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));

const ORIGIN = 'https://juno.example.com';
const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const HANDLE = 'maya.example.com';
const PDS = 'https://pds.example.net';
const ISSUER = 'https://auth.example.net';

type Call = { method: string; url: string; body: URLSearchParams; dpop: { header: any; payload: any } | null };

function decodeJwt(token: string) {
  const [header, payload, signature] = token.split('.');
  const json = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  const parsed = { header: json(header), payload: json(payload) };
  const publicKey = Uint8Array.from([4, ...fromBase64url(parsed.header.jwk.x), ...fromBase64url(parsed.header.jwk.y)]);
  const valid = p256.verify(fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`), publicKey);
  if (!valid) throw new Error('DPoP proof signature does not verify');
  return parsed;
}

function fakeNetwork() {
  const calls: Call[] = [];
  let issued = 0;
  let nonceSent = false;
  const state = { refreshResult: 'ok' as 'ok' | 'revoked' | 'offline' };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const tokens = () => {
    issued += 1;
    return json({ access_token: `access-${issued}`, token_type: 'DPoP', refresh_token: `refresh-${issued}`, scope: 'atproto', sub: DID, expires_in: 300 });
  };

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const dpopHeader = request.headers.get('dpop');
    const call: Call = { method: request.method, url: url.origin + decodeURIComponent(url.pathname), body: new URLSearchParams(request.method === 'POST' ? await request.text() : ''), dpop: dpopHeader ? decodeJwt(dpopHeader) : null };
    calls.push(call);
    if (call.dpop && (call.dpop.payload.htm !== request.method || call.dpop.payload.htu !== url.origin + url.pathname)) throw new Error('DPoP proof does not match the request');

    switch (call.url) {
      case 'https://bsky.social/xrpc/com.atproto.identity.resolveHandle':
        return url.searchParams.get('handle') === HANDLE ? json({ did: DID }) : json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400);
      case `https://plc.directory/${DID}`:
        return json({
          '@context': ['https://www.w3.org/ns/did/v1'],
          id: DID,
          alsoKnownAs: [`at://${HANDLE}`],
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
        });
      case `${PDS}/.well-known/oauth-protected-resource`:
        return json({ resource: PDS, authorization_servers: [ISSUER] });
      case `${ISSUER}/.well-known/oauth-authorization-server`:
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth/authorize`,
          token_endpoint: `${ISSUER}/oauth/token`,
          pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
          revocation_endpoint: `${ISSUER}/oauth/revoke`,
          require_pushed_authorization_requests: true,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          dpop_signing_alg_values_supported: ['ES256'],
          scopes_supported: ['atproto'],
          authorization_response_iss_parameter_supported: true,
          client_id_metadata_document_supported: true,
          protected_resources: [PDS],
        });
      case `${ISSUER}/oauth/par`:
        if (!nonceSent) {
          nonceSent = true;
          return json({ error: 'use_dpop_nonce' }, 400, { 'DPoP-Nonce': 'nonce-1' });
        }
        return json({ request_uri: 'urn:ietf:params:oauth:request_uri:req-1', expires_in: 300 }, 201);
      case `${ISSUER}/oauth/token`:
        if (call.body.get('grant_type') === 'authorization_code') return tokens();
        if (state.refreshResult === 'offline') throw new TypeError('Network request failed');
        if (state.refreshResult === 'revoked') return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
        return tokens();
      case `${ISSUER}/oauth/revoke`:
        return new Response(null, { status: 200 });
      case `${PDS}/xrpc/app.bsky.feed.getTimeline`:
        return json({ feed: [] });
    }
    throw new Error(`Unexpected request to ${call.url}`);
  };
  return { fetch, calls, state };
}

function setup() {
  const network = fakeNetwork();
  const store = createMemoryStore();
  const deleted: string[] = [];
  const client = createOAuthClient({
    origin: ORIGIN,
    store,
    randomBytes,
    fetch: network.fetch as typeof fetch,
    onSessionDeleted: (sub) => void deleted.push(sub),
  });
  return { client, store, network, deleted };
}

async function signIn(context: ReturnType<typeof setup>) {
  const url = await context.client.authorize(HANDLE, { display: 'touch' });
  const par = context.network.calls.filter((call) => call.url.endsWith('/oauth/par')).at(-1)!;
  const callback = new URLSearchParams({ code: 'code-1', state: par.body.get('state')!, iss: ISSUER });
  const { session } = await context.client.callback(callback, { redirect_uri: context.client.clientMetadata.redirect_uris[0] });
  context.deleted.length = 0;
  return { url, par, session };
}

async function expireStoredSession(store: ReturnType<typeof createMemoryStore>) {
  const saved = JSON.parse((await store.get(OAUTH_SESSION_KEY))!);
  saved.tokenSet.expires_at = new Date(Date.now() - 60_000).toISOString();
  await store.set(OAUTH_SESSION_KEY, JSON.stringify(saved));
}

describe('Bluesky OAuth client', () => {
  it("resolves the handle to the user's own server and pushes a PKCE, DPoP-bound authorization request", async () => {
    const context = setup();
    const { url, par } = await signIn(context);
    expect(url.toString()).toBe(`${ISSUER}/oauth/authorize?client_id=${encodeURIComponent(`${ORIGIN}/oauth/client-metadata.json`)}&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Areq-1`);
    expect(Object.fromEntries(par.body)).toMatchObject({
      client_id: `${ORIGIN}/oauth/client-metadata.json`,
      redirect_uri: 'com.example.juno:/oauth/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
      login_hint: HANDLE,
      display: 'touch',
    });
    expect(par.body.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(par.body.get('scope')).toContain('atproto');
    expect(par.dpop?.payload.nonce).toBe('nonce-1');
    expect(par.dpop?.header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256' } });
    expect(par.dpop?.header.jwk.d).toBeUndefined();
  });

  it('exchanges the code and keeps the tokens and the DPoP key only in the device store', async () => {
    const context = setup();
    const { session } = await signIn(context);
    expect(session.did).toBe(DID);
    const token = context.network.calls.find((call) => call.body.get('grant_type') === 'authorization_code')!;
    expect(token.body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const saved = JSON.parse((await context.store.get(OAUTH_SESSION_KEY))!);
    expect(saved).toMatchObject({ sub: DID, tokenSet: { access_token: 'access-1', refresh_token: 'refresh-1', iss: ISSUER }, dpopJwk: { kty: 'EC', crv: 'P-256' } });
    expect(saved.dpopJwk.d).toEqual(expect.any(String));

    await session.fetchHandler('/xrpc/app.bsky.feed.getTimeline', { method: 'GET' });
    const api = context.network.calls.at(-1)!;
    expect(api.dpop?.payload).toMatchObject({ htm: 'GET', htu: `${PDS}/xrpc/app.bsky.feed.getTimeline`, ath: expect.any(String) });
    expect(api.dpop?.header.jwk.x).toBe(saved.dpopJwk.x);
  });

  it('refreshes an expired session silently when it is restored after a relaunch', async () => {
    const first = setup();
    await signIn(first);
    await expireStoredSession(first.store);
    const deleted: string[] = [];
    const relaunched = createOAuthClient({
      origin: ORIGIN,
      store: first.store,
      randomBytes,
      fetch: first.network.fetch as typeof fetch,
      onSessionDeleted: (sub) => void deleted.push(sub),
    });
    const session = await relaunched.restore(DID);
    expect(session.did).toBe(DID);
    expect(deleted).toEqual([]);
    expect(JSON.parse((await first.store.get(OAUTH_SESSION_KEY))!).tokenSet).toMatchObject({ access_token: 'access-2', refresh_token: 'refresh-2' });
    expect(first.network.calls.filter((call) => call.body.get('grant_type') === 'refresh_token')).toHaveLength(1);
  });

  it('deletes the session and reports it when the refresh token is no longer accepted', async () => {
    const context = setup();
    await signIn(context);
    await expireStoredSession(context.store);
    context.network.state.refreshResult = 'revoked';
    await expect(context.client.restore(DID)).rejects.toBeInstanceOf(TokenRefreshError);
    expect(await context.store.get(OAUTH_SESSION_KEY)).toBeNull();
    expect(context.deleted).toEqual([DID]);
  });

  it('keeps the session when a refresh fails only because the network is down', async () => {
    const context = setup();
    await signIn(context);
    await expireStoredSession(context.store);
    context.network.state.refreshResult = 'offline';
    await expect(context.client.restore(DID)).rejects.toThrow();
    expect(await context.store.get(OAUTH_SESSION_KEY)).not.toBeNull();
    expect(context.deleted).toEqual([]);
  });

  it('refuses a handle that does not resolve', async () => {
    const context = setup();
    await expect(context.client.authorize('nobody.example.com')).rejects.toThrow(/resolve/i);
  });
});
