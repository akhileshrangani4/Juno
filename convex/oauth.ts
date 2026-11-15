import { httpAction } from './_generated/server';
import { oauthClientMetadata } from './oauthClientMetadata';

export const clientMetadata = httpAction(async (_ctx, request) => {
  return new Response(JSON.stringify(oauthClientMetadata(new URL(request.url).origin)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
