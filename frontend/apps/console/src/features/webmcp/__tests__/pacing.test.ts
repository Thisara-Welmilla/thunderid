// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, it, vi} from 'vitest';
import {sleep, typeInto} from '../utils/pacing';

afterEach(() => {
  vi.useRealTimers();
});

describe('sleep', () => {
  it('resolves immediately for a non-positive delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-5)).resolves.toBeUndefined();
  });

  it('waits the given delay', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void sleep(500).then(done);

    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });
});

describe('typeInto', () => {
  it('applies the whole value once when unpaced', async () => {
    const apply = vi.fn();
    await typeInto(apply, 'Storefront', 0);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('Storefront');
  });

  it('applies growing prefixes one character at a time when paced', async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const pending = typeInto(apply, 'abc', 10);

    await vi.advanceTimersByTimeAsync(30);
    await pending;

    expect(apply.mock.calls.map((call) => call[0] as string)).toEqual(['a', 'ab', 'abc']);
  });
});
