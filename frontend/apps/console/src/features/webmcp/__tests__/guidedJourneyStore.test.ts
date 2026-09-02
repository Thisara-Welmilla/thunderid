// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, it, vi} from 'vitest';
import {WebMcpRefusalCodes, type GuidedApplicationDraft} from '../models/journey';
import {
  GuidedPhases,
  begin,
  getSnapshot,
  isRefusal,
  markPrefilled,
  requestSubmit,
  settleFailure,
  settleSuccess,
  subscribe,
  waitUntilPrefilled,
} from '../store/guidedJourneyStore';

const draft: GuidedApplicationDraft = {
  template: 'REACT',
  templateId: 'react',
  templateDisplayName: 'React',
  name: 'Storefront',
  redirectUris: ['https://app.example.com/callback'],
  ouId: null,
  ouName: null,
};

afterEach(() => {
  // Leave the module-level store idle for the next test, settling anything still in flight.
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'test cleanup'});
  }
  vi.useRealTimers();
});

describe('guidedJourneyStore', () => {
  it('starts idle', () => {
    expect(getSnapshot()).toEqual({phase: GuidedPhases.IDLE, operation: null});
  });

  it('walks prefilling to ready to submitting', async () => {
    const pending = begin({kind: 'createApplication', draft});
    expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);

    markPrefilled();
    expect(getSnapshot().phase).toBe(GuidedPhases.READY);

    requestSubmit();
    expect(getSnapshot().phase).toBe(GuidedPhases.SUBMITTING);

    settleSuccess({applicationId: 'app-1', clientId: 'client-1'});

    await expect(pending).resolves.toEqual({applicationId: 'app-1', clientId: 'client-1'});
    expect(getSnapshot().phase).toBe(GuidedPhases.IDLE);
  });

  it('will not submit before the page is ready', () => {
    void begin({kind: 'createApplication', draft});
    requestSubmit();

    expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
  });

  it('resolves rather than rejects on refusal, so an abandoned call cannot go unhandled', async () => {
    const pending = begin({kind: 'createApplication', draft});
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'declined'});

    const outcome = await pending;

    expect(isRefusal(outcome)).toBe(true);
    expect(outcome).toEqual({code: WebMcpRefusalCodes.DECLINED, message: 'declined'});
  });

  it('notifies subscribers of every phase change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    void begin({kind: 'createApplication', draft});
    markPrefilled();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('exposes only the matching operation kind', () => {
    void begin({
      kind: 'configureLoginFlow',
      draft: {applicationId: 'app-1', applicationName: 'Storefront', flowId: 'flow-1', flowName: 'Basic'},
    });

    expect(getSnapshot().operation?.kind).toBe('configureLoginFlow');
  });

  it('resolves waitUntilPrefilled once the page takes the draft', async () => {
    void begin({kind: 'createApplication', draft});
    const waiting = waitUntilPrefilled(1000);
    markPrefilled();

    await expect(waiting).resolves.toBe(true);
  });

  it('gives up on waitUntilPrefilled when the page never mounts', async () => {
    vi.useFakeTimers();
    void begin({kind: 'createApplication', draft});
    const waiting = waitUntilPrefilled(1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(waiting).resolves.toBe(false);
  });

  it('resolves waitUntilPrefilled false when nothing is in flight', async () => {
    await expect(waitUntilPrefilled(1000)).resolves.toBe(false);
  });
});
