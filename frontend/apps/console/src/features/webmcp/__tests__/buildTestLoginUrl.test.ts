// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import buildTestLoginUrl from '../utils/buildTestLoginUrl';

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('buildTestLoginUrl', () => {
  const options = {
    serverUrl: 'https://localhost:8090',
    clientId: 'client-123',
    redirectUri: 'https://app.example.com/callback',
  };

  it('targets the deployment authorization endpoint', async () => {
    const {url} = await buildTestLoginUrl(options);

    expect(new URL(url).origin + new URL(url).pathname).toBe('https://localhost:8090/oauth2/authorize');
  });

  it('does not double the slash when the server URL has a trailing one', async () => {
    const {url} = await buildTestLoginUrl({...options, serverUrl: 'https://localhost:8090/'});

    expect(url).toContain('https://localhost:8090/oauth2/authorize?');
  });

  it('requests an authorization code with PKCE', async () => {
    const {url, codeVerifier} = await buildTestLoginUrl(options);
    const params = new URL(url).searchParams;

    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('client-123');
    expect(params.get('redirect_uri')).toBe('https://app.example.com/callback');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(await sha256Base64Url(codeVerifier));
  });

  it('asks for openid scope and carries state', async () => {
    const {url, state} = await buildTestLoginUrl(options);
    const params = new URL(url).searchParams;

    expect(params.get('scope')?.split(' ')).toContain('openid');
    expect(params.get('state')).toBe(state);
    expect(state.length).toBeGreaterThan(0);
  });

  it('uses a fresh verifier and state each time', async () => {
    const first = await buildTestLoginUrl(options);
    const second = await buildTestLoginUrl(options);

    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.state).not.toBe(second.state);
  });
});
