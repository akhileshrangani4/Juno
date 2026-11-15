/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as describe from "../describe.js";
import type * as describeCache from "../describeCache.js";
import type * as describeCaptions from "../describeCaptions.js";
import type * as describeOpenAI from "../describeOpenAI.js";
import type * as describePrompt from "../describePrompt.js";
import type * as describeSource from "../describeSource.js";
import type * as didWeb from "../didWeb.js";
import type * as http from "../http.js";
import type * as memory from "../memory.js";
import type * as memoryAccess from "../memoryAccess.js";
import type * as memoryAuth from "../memoryAuth.js";
import type * as memoryLimits from "../memoryLimits.js";
import type * as memoryOwners from "../memoryOwners.js";
import type * as memoryService from "../memoryService.js";
import type * as oauth from "../oauth.js";
import type * as oauthClientMetadata from "../oauthClientMetadata.js";
import type * as postDescriptions from "../postDescriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  describe: typeof describe;
  describeCache: typeof describeCache;
  describeCaptions: typeof describeCaptions;
  describeOpenAI: typeof describeOpenAI;
  describePrompt: typeof describePrompt;
  describeSource: typeof describeSource;
  didWeb: typeof didWeb;
  http: typeof http;
  memory: typeof memory;
  memoryAccess: typeof memoryAccess;
  memoryAuth: typeof memoryAuth;
  memoryLimits: typeof memoryLimits;
  memoryOwners: typeof memoryOwners;
  memoryService: typeof memoryService;
  oauth: typeof oauth;
  oauthClientMetadata: typeof oauthClientMetadata;
  postDescriptions: typeof postDescriptions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
