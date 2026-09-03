// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getWebMcpSpeed, getWebMcpTimings} from '../utils/webMcpSpeed';

// The test environment ships without a writable localStorage, so stand up an in-memory one.
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    length: 0,
  });
  return store;
}

let store: Map<string, string>;

beforeEach(() => {
  store = installMemoryStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webMcpSpeed', () => {
  it('defaults to off, with all delays zero', () => {
    expect(getWebMcpSpeed()).toBe('off');
    expect(getWebMcpTimings()).toEqual({enabled: false, perCharMs: 0, preClickMs: 0, cursorMoveMs: 0});
  });

  it('reads a valid speed from localStorage', () => {
    store.set('webmcpSpeed', 'slow');

    expect(getWebMcpSpeed()).toBe('slow');
    const timings = getWebMcpTimings();
    expect(timings.enabled).toBe(true);
    expect(timings.perCharMs).toBeGreaterThan(0);
    expect(timings.preClickMs).toBeGreaterThan(0);
    expect(timings.cursorMoveMs).toBeGreaterThan(0);
  });

  it('ignores an unknown stored value', () => {
    store.set('webmcpSpeed', 'ludicrous');

    expect(getWebMcpSpeed()).toBe('off');
  });

  it('orders the speeds from slow to fast', () => {
    store.set('webmcpSpeed', 'slow');
    const slow = getWebMcpTimings().perCharMs;
    store.set('webmcpSpeed', 'fast');
    const fast = getWebMcpTimings().perCharMs;

    expect(slow).toBeGreaterThan(fast);
  });
});
