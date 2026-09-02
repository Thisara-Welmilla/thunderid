// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The scopes a test login asks for: enough to prove an ID token comes back, nothing more.
 *
 * @internal
 */
const TEST_LOGIN_SCOPES = 'openid profile email';

/**
 * A test login's authorization request.
 *
 * @public
 */
export interface TestLoginRequest {
  /**
   * The full authorization URL to open.
   */
  url: string;
  /**
   * The PKCE code verifier. Returned so the agent can tell the admin what their application will
   * need in order to complete the code exchange; it is never stored or sent anywhere by the console.
   */
  codeVerifier: string;
  /**
   * The `state` value, so the admin can recognize the callback as this request's.
   */
  state: string;
}

/**
 * Options for {@link buildTestLoginUrl}.
 *
 * @public
 */
export interface BuildTestLoginUrlOptions {
  /**
   * Deployment server URL, from `useConfig().getServerUrl()`.
   */
  serverUrl: string;
  clientId: string;
  redirectUri: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return toBase64Url(bytes);
}

/**
 * Builds the authorization request for a test login against an application the journey created.
 *
 * Always authorization code with PKCE (`S256`) - the same profile the journey's templates are
 * restricted to - so the test exercises the configuration the admin actually deployed. The
 * authorization endpoint is the deployment's own `/oauth2/authorize`, matching what the
 * application's Overview tab lists under Useful Endpoints.
 *
 * @param options - Server URL and the application's client identifier and redirect URI
 * @returns The authorization URL, plus the PKCE verifier and state behind it
 *
 * @public
 */
export default async function buildTestLoginUrl({
  serverUrl,
  clientId,
  redirectUri,
}: BuildTestLoginUrlOptions): Promise<TestLoginRequest> {
  const codeVerifier = randomBase64Url(32);
  const state = randomBase64Url(16);

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = toBase64Url(new Uint8Array(digest));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: TEST_LOGIN_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${serverUrl.replace(/\/+$/, '')}/oauth2/authorize?${params.toString()}`,
    codeVerifier,
    state,
  };
}
