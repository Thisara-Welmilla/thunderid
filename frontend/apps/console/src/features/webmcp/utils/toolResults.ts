// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {WebMcpRefusalCodes, type WebMcpRefusal, type WebMcpRefusalCode} from '../models/journey';
import type {WebMcpToolResult} from '../models/webmcp';

/**
 * Returns a successful tool result carrying a JSON payload.
 *
 * @param payload - The data the agent asked for
 * @returns The tool result
 *
 * @public
 */
export function toolSuccess(payload: unknown): WebMcpToolResult {
  return {content: [{type: 'text', text: JSON.stringify(payload, null, 2)}]};
}

/**
 * Returns a refusal as an error result rather than a thrown exception, so the agent gets the reason
 * and can narrate it or correct the call instead of seeing an opaque failure.
 *
 * @param refusal - Why the tool would not act
 * @returns The tool result
 *
 * @public
 */
export function toolRefusal(refusal: WebMcpRefusal): WebMcpToolResult {
  return {
    content: [{type: 'text', text: JSON.stringify(refusal, null, 2)}],
    isError: true,
  };
}

const REFUSAL_CODES: readonly string[] = Object.values(WebMcpRefusalCodes);

/**
 * Narrows an unknown thrown value to a refusal, falling back to a generic request failure. Used at
 * the edge of every tool so an unexpected throw still reaches the agent as structured text.
 *
 * The `code` is checked against this feature's own catalog rather than merely being present. Errors
 * thrown by the SDK and the HTTP layer carry a `code` and a `message` too (e.g.
 * `SPA-AUTH_HELPER-HR-SE01`), and passing one straight through would hand the agent an unlocalized
 * transport code in place of the refusal the tool meant to give, in the same way that surfacing
 * server-returned error text to the admin is disallowed.
 *
 * @param error - The thrown value
 * @param fallback - The refusal to use when `error` is not one
 * @returns A refusal
 *
 * @public
 */
export function asRefusal(error: unknown, fallback: WebMcpRefusal): WebMcpRefusal {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as {code: unknown}).code === 'string' &&
    REFUSAL_CODES.includes((error as {code: string}).code)
  ) {
    return error as {code: WebMcpRefusalCode} & WebMcpRefusal;
  }

  return fallback;
}
