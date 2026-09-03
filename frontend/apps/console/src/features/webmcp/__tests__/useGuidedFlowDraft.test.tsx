// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, renderHook, waitFor} from '@thunderid/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import useGuidedFlowDraft from '../hooks/useGuidedFlowDraft';
import type {UseGuidedFlowDraftOptions} from '../hooks/useGuidedFlowDraft';
import {WebMcpRefusalCodes} from '../models/journey';
import {
  GuidedPhases,
  begin,
  getSnapshot,
  isRefusal,
  requestSubmit,
  settleFailure,
} from '../store/guidedJourneyStore';

vi.mock('@thunderid/contexts', async () => {
  const actual = await vi.importActual<typeof import('@thunderid/contexts')>('@thunderid/contexts');
  return {...actual, useConfig: () => ({config: {brand: {product_name: 'ThunderID'}}, getServerUrl: () => ''})};
});

const draft = {
  name: 'Passwordless login',
  handle: 'passwordless-login',
  templateType: 'CREDENTIALS_AUTH',
  templateLabel: 'Username & Password',
  flowType: 'AUTHENTICATION',
};

function makeOptions(overrides: Partial<UseGuidedFlowDraftOptions> = {}): UseGuidedFlowDraftOptions {
  return {
    applyTemplate: vi.fn(),
    applyName: vi.fn(),
    openConfigureStep: vi.fn(),
    submit: vi.fn(),
    createdFlowId: undefined,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Keep these assertions on the unpaced path (name applied once), independent of any speed a
  // sibling test left in storage.
  try {
    localStorage.removeItem('webmcpSpeed');
  } catch {
    // Ignore when storage is unavailable.
  }
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'reset'});
  }
});

afterEach(() => {
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'cleanup'});
  }
  vi.clearAllMocks();
});

describe('useGuidedFlowDraft', () => {
  it('does nothing when no guided flow creation is in flight', () => {
    const options = makeOptions();
    renderHook(() => useGuidedFlowDraft(options));

    expect(options.applyTemplate).not.toHaveBeenCalled();
    expect(options.applyName).not.toHaveBeenCalled();
  });

  it('stages the resolved template and name, then marks the wizard prefilled', async () => {
    const options = makeOptions();
    renderHook(() => useGuidedFlowDraft(options));

    act(() => {
      void begin({kind: 'createLoginFlow', draft});
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });

    expect(options.applyName).toHaveBeenCalledWith(draft.name, draft.handle);
    expect(options.openConfigureStep).toHaveBeenCalled();
    const call = (options.applyTemplate as ReturnType<typeof vi.fn>).mock.calls[0] as [string, {type: string}];
    expect(call[0]).toBe('AUTHENTICATION');
    expect(call[1].type).toBe(draft.templateType);
  });

  it('submits once when the store moves to SUBMITTING', async () => {
    const options = makeOptions();
    renderHook(() => useGuidedFlowDraft(options));

    act(() => {
      void begin({kind: 'createLoginFlow', draft});
    });
    await waitFor(() => expect(getSnapshot().phase).toBe(GuidedPhases.READY));

    act(() => {
      requestSubmit();
    });

    await waitFor(() => {
      expect(options.submit).toHaveBeenCalledTimes(1);
    });
  });

  it('settles the operation with the created flow id', async () => {
    const props: {createdFlowId?: string} = {createdFlowId: undefined};
    const options = makeOptions();
    const {rerender} = renderHook(() => useGuidedFlowDraft({...options, createdFlowId: props.createdFlowId}));

    const pending = begin({kind: 'createLoginFlow', draft});
    await waitFor(() => expect(getSnapshot().phase).toBe(GuidedPhases.READY));
    act(() => {
      requestSubmit();
    });
    await waitFor(() => expect(getSnapshot().phase).toBe(GuidedPhases.SUBMITTING));

    props.createdFlowId = 'flow-42';
    act(() => {
      rerender();
    });

    const outcome = await pending;
    expect(isRefusal(outcome)).toBe(false);
    expect(outcome).toMatchObject({flowId: 'flow-42'});
    expect(getSnapshot().phase).toBe(GuidedPhases.IDLE);
  });

  it('surfaces the wizard error as a refusal', async () => {
    const props: {error: string | null} = {error: null};
    const options = makeOptions();
    const {rerender} = renderHook(() => useGuidedFlowDraft({...options, error: props.error}));

    const pending = begin({kind: 'createLoginFlow', draft});
    await waitFor(() => expect(getSnapshot().phase).toBe(GuidedPhases.READY));
    act(() => {
      requestSubmit();
    });
    await waitFor(() => expect(getSnapshot().phase).toBe(GuidedPhases.SUBMITTING));

    props.error = 'A flow with this handle already exists.';
    act(() => {
      rerender();
    });

    const outcome = await pending;
    expect(isRefusal(outcome)).toBe(true);
    expect(outcome).toMatchObject({code: WebMcpRefusalCodes.REQUEST_FAILED});
  });
});
