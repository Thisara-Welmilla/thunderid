// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {KNOWN_CONTEXT_KEYS} from '@thunderid/configure-design';
import {describe, it, expect} from 'vitest';
import {CONTEXT_TOKENS} from '../template-tokens';

/** Extracts the key from a `{{ctx(key)}}` insert string. */
function ctxKey(insert: string): string | undefined {
  return /^\{\{ctx\(([A-Za-z0-9_.-]+)\)\}\}$/.exec(insert)?.[1];
}

describe('CONTEXT_TOKENS', () => {
  // The editor's unknown-context validator (KNOWN_CONTEXT_KEYS, in configure-design) and the catalog
  // the picker offers must stay identical, or a token the UI offers would be flagged as unknown — or
  // an unknown token would pass validation.
  it('offers exactly the keys the preview validator recognizes', () => {
    const catalogKeys = CONTEXT_TOKENS.map((token) => ctxKey(token.insert));
    expect(catalogKeys.every((key) => key !== undefined)).toBe(true);
    expect(new Set(catalogKeys)).toEqual(KNOWN_CONTEXT_KEYS);
  });
});
