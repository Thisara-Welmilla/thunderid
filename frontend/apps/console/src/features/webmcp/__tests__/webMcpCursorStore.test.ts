// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  getSnapshot,
  hideCursor,
  moveCursor,
  placeCursor,
  pulseCursor,
  setCursorTarget,
  subscribe,
} from '../store/webMcpCursorStore';

afterEach(() => {
  hideCursor();
  vi.useRealTimers();
});

describe('webMcpCursorStore', () => {
  it('starts hidden', () => {
    expect(getSnapshot().visible).toBe(false);
  });

  it('places the cursor with no glide and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    placeCursor(120, 240);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toMatchObject({visible: true, x: 120, y: 240, moveMs: 0});
    unsubscribe();
  });

  it('moves the cursor and resolves after the glide duration', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void moveCursor(300, 300, 400).then(done);

    expect(getSnapshot()).toMatchObject({visible: true, x: 300, y: 300, moveMs: 400});
    await vi.advanceTimersByTimeAsync(399);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it('resolves a zero-duration move immediately', async () => {
    await expect(moveCursor(10, 10, 0)).resolves.toBeUndefined();
  });

  it('shows a click pulse then clears it', async () => {
    vi.useFakeTimers();
    placeCursor(50, 50);
    const done = vi.fn();
    void pulseCursor(200).then(done);

    expect(getSnapshot().clicking).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(getSnapshot().clicking).toBe(false);
    expect(done).toHaveBeenCalled();
  });

  it('sets and clears the highlight target, and hiding clears it', () => {
    const el = document.createElement('button');
    placeCursor(5, 5);
    setCursorTarget(el);
    expect(getSnapshot().targetEl).toBe(el);

    setCursorTarget(null);
    expect(getSnapshot().targetEl).toBeNull();

    setCursorTarget(el);
    hideCursor();
    expect(getSnapshot().targetEl).toBeNull();
  });

  it('hides the cursor', () => {
    placeCursor(1, 1);
    hideCursor();
    expect(getSnapshot().visible).toBe(false);
  });
});
