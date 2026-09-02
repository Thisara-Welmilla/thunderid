// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import isValidRedirectUriFormat from '../../applications/utils/isValidRedirectUriFormat';
import {WebMcpRefusalCodes, type WebMcpRefusal} from '../models/journey';

/**
 * Hosts for which plain `http` is accepted, matching the loopback exception every OAuth2 security
 * BCP makes for local development.
 *
 * @internal
 */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * Validates the redirect URIs a `create_application` call supplied, refusing anything the journey
 * should not create on the agent's word.
 *
 * Deliberately stricter than the wizard's own {@link isValidRedirectUriFormat}, which tolerates
 * host and path wildcards because the backend enforces the actual wildcard rules for an admin
 * typing into the form. A tool driven by an agent gets no such benefit of the doubt: a wildcard
 * redirect URI is refused outright and named in the refusal, so the agent has to come back with a
 * concrete one.
 *
 * @param redirectUris - The URIs as supplied by the calling agent
 * @returns The trimmed URIs, or a refusal naming the first offending URI
 *
 * @public
 */
export default function validateRedirectUris(redirectUris: unknown): string[] | WebMcpRefusal {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return {
      code: WebMcpRefusalCodes.REDIRECT_URI_REQUIRED,
      message: 'At least one redirect URI is required. Ask which URL the application should be sent back to.',
    };
  }

  const trimmed: string[] = [];

  for (const candidate of redirectUris) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_REQUIRED,
        message: 'Every redirect URI must be a non-empty string.',
      };
    }

    const uri = candidate.trim();

    if (uri.includes('*')) {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_WILDCARD,
        message:
          `The redirect URI "${uri}" contains a wildcard. A wildcard lets an attacker redirect the ` +
          'authorization code to a host they control, so this journey only creates applications with exact ' +
          'redirect URIs. Ask for the exact callback URL.',
        details: {redirectUri: uri},
      };
    }

    if (!isValidRedirectUriFormat(uri)) {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_MALFORMED,
        message: `The redirect URI "${uri}" is not a valid absolute URI.`,
        details: {redirectUri: uri},
      };
    }

    const parsed = new URL(uri);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_SCHEME,
        message:
          `The redirect URI "${uri}" uses the "${parsed.protocol}" scheme. This journey creates web ` +
          'applications, so redirect URIs must be http or https.',
        details: {redirectUri: uri},
      };
    }

    if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.includes(parsed.hostname)) {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_INSECURE,
        message:
          `The redirect URI "${uri}" sends the authorization code over plain http to a host that is not ` +
          'loopback. Use https, or a localhost URL for local development.',
        details: {redirectUri: uri},
      };
    }

    if (parsed.hash) {
      return {
        code: WebMcpRefusalCodes.REDIRECT_URI_FRAGMENT,
        message: `The redirect URI "${uri}" carries a fragment, which is not allowed in a registered redirect URI.`,
        details: {redirectUri: uri},
      };
    }

    trimmed.push(uri);
  }

  return trimmed;
}
