// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import {WebMcpRefusalCodes} from '../models/journey';
import validateRedirectUris from '../utils/validateRedirectUris';

function refusalCode(input: unknown): string | undefined {
  const result = validateRedirectUris(input);
  return Array.isArray(result) ? undefined : result.code;
}

describe('validateRedirectUris', () => {
  it('accepts an https redirect URI', () => {
    expect(validateRedirectUris(['https://app.example.com/callback'])).toEqual(['https://app.example.com/callback']);
  });

  it('trims each URI', () => {
    expect(validateRedirectUris(['  https://app.example.com/callback  '])).toEqual([
      'https://app.example.com/callback',
    ]);
  });

  it('accepts plain http on loopback hosts', () => {
    expect(validateRedirectUris(['http://localhost:5173', 'http://127.0.0.1:3000/callback'])).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:3000/callback',
    ]);
  });

  it.each([
    [undefined, WebMcpRefusalCodes.REDIRECT_URI_REQUIRED],
    [[], WebMcpRefusalCodes.REDIRECT_URI_REQUIRED],
    [['   '], WebMcpRefusalCodes.REDIRECT_URI_REQUIRED],
    [[42], WebMcpRefusalCodes.REDIRECT_URI_REQUIRED],
    [['https://*.example.com/callback'], WebMcpRefusalCodes.REDIRECT_URI_WILDCARD],
    [['https://app.example.com/callback/*'], WebMcpRefusalCodes.REDIRECT_URI_WILDCARD],
    [['not-a-uri'], WebMcpRefusalCodes.REDIRECT_URI_MALFORMED],
    [['myapp://callback'], WebMcpRefusalCodes.REDIRECT_URI_SCHEME],
    [['http://app.example.com/callback'], WebMcpRefusalCodes.REDIRECT_URI_INSECURE],
    [['https://app.example.com/callback#token'], WebMcpRefusalCodes.REDIRECT_URI_FRAGMENT],
  ])('refuses %j', (input, expected) => {
    expect(refusalCode(input)).toBe(expected);
  });

  it('names the offending URI in the refusal', () => {
    const result = validateRedirectUris(['https://ok.example.com/cb', 'https://*.evil.example.com/cb']);

    expect(Array.isArray(result)).toBe(false);
    expect((result as {details?: Record<string, unknown>}).details).toEqual({
      redirectUri: 'https://*.evil.example.com/cb',
    });
  });
});
