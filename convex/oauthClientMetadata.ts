export const OAUTH_CLIENT_METADATA_PATH = '/oauth/client-metadata.json';
export const OAUTH_REDIRECT_PATH = '/oauth/callback';

const BLUESKY_APPVIEW = 'did:web:api.bsky.app%23bsky_appview';

export const OAUTH_SCOPES = [
  'atproto',
  'repo:app.bsky.feed.post?action=create',
  'repo:app.bsky.feed.post?action=delete',
  'repo:app.bsky.feed.like?action=create',
  'repo:app.bsky.feed.like?action=delete',
  'repo:app.bsky.feed.repost?action=create',
  'repo:app.bsky.feed.repost?action=delete',
  'blob:image/*',
  `rpc:app.bsky.feed.getTimeline?aud=${BLUESKY_APPVIEW}`,
  `rpc:app.bsky.feed.getAuthorFeed?aud=${BLUESKY_APPVIEW}`,
  `rpc:app.bsky.feed.getPosts?aud=${BLUESKY_APPVIEW}`,
  `rpc:app.bsky.feed.getPostThread?aud=${BLUESKY_APPVIEW}`,
  `rpc:app.bsky.actor.getProfile?aud=${BLUESKY_APPVIEW}`,
];

export function oauthRedirectUri(origin: string): string {
  const scheme = new URL(origin).hostname.split('.').reverse().join('.');
  return `${scheme}:${OAUTH_REDIRECT_PATH}`;
}

export function oauthClientMetadata(origin: string) {
  const base = new URL(origin).origin;
  return {
    client_id: `${base}${OAUTH_CLIENT_METADATA_PATH}`,
    client_name: 'Juno',
    application_type: 'native' as const,
    redirect_uris: [oauthRedirectUri(base)] as [string],
    scope: OAUTH_SCOPES.join(' '),
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    token_endpoint_auth_method: 'none' as const,
    dpop_bound_access_tokens: true,
  };
}
