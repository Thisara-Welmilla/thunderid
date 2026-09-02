// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import {WebMcpRefusalCodes} from '../models/journey';
import {asRefusal, toolRefusal, toolSuccess} from '../utils/toolResults';

const fallback = {code: WebMcpRefusalCodes.REQUEST_FAILED, message: 'Could not list organization units.'};

describe('toolSuccess', () => {
  it('serializes the payload as JSON text', () => {
    const result = toolSuccess({id: 'app-1'});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({id: 'app-1'});
  });
});

describe('toolRefusal', () => {
  it('marks the result as an error', () => {
    const result = toolRefusal(fallback);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual(fallback);
  });
});

describe('asRefusal', () => {
  it('passes through one of this feature refusal codes', () => {
    const refusal = {code: WebMcpRefusalCodes.DECLINED, message: 'declined'};

    expect(asRefusal(refusal, fallback)).toBe(refusal);
  });

  it('falls back for a plain Error', () => {
    expect(asRefusal(new Error('boom'), fallback)).toBe(fallback);
  });

  it('falls back for an SDK error that happens to carry a code and a message', () => {
    // Regression: the SDK throws objects shaped like {code, message} (e.g.
    // 'SPA-AUTH_HELPER-HR-SE01'). Passing one through would hand the agent an unlocalized transport
    // code instead of the refusal the tool meant to give.
    const sdkError = Object.assign(new Error('No refresh token found.'), {code: 'SPA-AUTH_HELPER-HR-SE01'});

    expect(asRefusal(sdkError, fallback)).toBe(fallback);
  });

  it('falls back for a non-string code', () => {
    expect(asRefusal({code: 500, message: 'nope'}, fallback)).toBe(fallback);
  });

  it('falls back for null and undefined', () => {
    expect(asRefusal(null, fallback)).toBe(fallback);
    expect(asRefusal(undefined, fallback)).toBe(fallback);
  });
});
