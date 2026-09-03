// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {announce, announceThinking, clearActivity, getSnapshot, subscribe} from '../store/webMcpActivityStore';

describe('webMcpActivityStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearActivity();
  });

  afterEach(() => {
    clearActivity();
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(getSnapshot()).toBeNull();
  });

  it('exposes the announced activity and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    announce({label: 'Opening Login Flows', spotlightPath: '/flows'});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toMatchObject({label: 'Opening Login Flows', spotlightPath: '/flows'});

    unsubscribe();
    announce({label: 'Opening Applications'});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('gives each announcement a new id, even when the label repeats', () => {
    announce({label: 'Opening Applications', spotlightPath: '/applications'});
    const first = getSnapshot()?.id;

    announce({label: 'Opening Applications', spotlightPath: '/applications'});
    const second = getSnapshot()?.id;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('returns a stable snapshot reference between announcements', () => {
    announce({label: 'Opening Users'});
    const snapshot = getSnapshot();

    expect(getSnapshot()).toBe(snapshot);
  });

  it('dismisses itself after the ttl', () => {
    announce({label: 'Opening Roles'}, 1000);
    expect(getSnapshot()).not.toBeNull();

    vi.advanceTimersByTime(999);
    expect(getSnapshot()).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBeNull();
  });

  it('a new announcement resets the dismissal timer of the previous one', () => {
    announce({label: 'Opening Groups'}, 1000);
    vi.advanceTimersByTime(900);

    announce({label: 'Opening Design'}, 1000);
    vi.advanceTimersByTime(900);
    expect(getSnapshot()).toMatchObject({label: 'Opening Design'});

    vi.advanceTimersByTime(100);
    expect(getSnapshot()).toBeNull();
  });

  it('clearActivity removes the current activity immediately', () => {
    announce({label: 'Opening Settings'});
    clearActivity();

    expect(getSnapshot()).toBeNull();
  });

  it('announceThinking shows a thinking state that a later action replaces', () => {
    announceThinking();
    expect(getSnapshot()).toMatchObject({thinking: true});

    announce({label: 'Opening Applications'});
    expect(getSnapshot()).toMatchObject({label: 'Opening Applications'});
    expect(getSnapshot()?.thinking).toBeFalsy();
  });

  it('the thinking state dismisses itself after its ttl', () => {
    announceThinking();
    expect(getSnapshot()).not.toBeNull();

    vi.advanceTimersByTime(12_000);
    expect(getSnapshot()).toBeNull();
  });
});
