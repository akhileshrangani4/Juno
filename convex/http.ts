import { httpRouter } from 'convex/server';

import { clientMetadata } from './oauth';
import { OAUTH_CLIENT_METADATA_PATH } from './oauthClientMetadata';

const http = httpRouter();

http.route({ path: OAUTH_CLIENT_METADATA_PATH, method: 'GET', handler: clientMetadata });

export default http;
