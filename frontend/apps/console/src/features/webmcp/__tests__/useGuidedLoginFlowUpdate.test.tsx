// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, renderHook, waitFor} from '@testing-library/react';
import type {Application} from '@thunderid/configure-applications';
import {afterEach, describe, expect, it, vi} from 'vitest';
import useGuidedLoginFlowUpdate from '../hooks/useGuidedLoginFlowUpdate';
import {WebMcpRefusalCodes} from '../models/journey';
import {GuidedPhases, begin, getSnapshot, requestSubmit, settleFailure} from '../store/guidedJourneyStore';

const flowOperation = {
  kind: 'configureLoginFlow',
  draft: {
    applicationId: 'app-1',
    applicationName: 'Storefront',
    flowId: 'flow-2',
    flowName: 'Password and Google',
    currentFlowId: 'flow-1',
  },
} as const;

function renderBridge(overrides?: {save?: () => Promise<Error | null>; applicationId?: string}) {
  const onFieldChange = vi.fn<(field: keyof Application, value: unknown) => void>();
  const onSelectTab = vi.fn<(tabKey: string) => void>();
  const save = overrides?.save ?? vi.fn(() => Promise.resolve(null));

  const rendered = renderHook(() =>
    useGuidedLoginFlowUpdate({
      applicationId: overrides?.applicationId ?? 'app-1',
      onFieldChange,
      save,
      resolveErrorMessage: () => 'An application cannot reference a different sign-up flow.',
      onSelectTab,
    }),
  );

  return {...rendered, onFieldChange, onSelectTab, save};
}

afterEach(() => {
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'test cleanup'});
  }
});

describe('useGuidedLoginFlowUpdate', () => {
  it('does nothing when no tool call is in flight', () => {
    const {onFieldChange, onSelectTab, save} = renderBridge();

    expect(onFieldChange).not.toHaveBeenCalled();
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('opens the Flows tab and stages the change through the page own handler', async () => {
    const {onFieldChange, onSelectTab} = renderBridge();

    act(() => {
      void begin(flowOperation);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });

    expect(onSelectTab).toHaveBeenCalledWith('flows');
    expect(onFieldChange).toHaveBeenCalledWith('authFlowId', 'flow-2');
  });

  it('ignores an operation aimed at a different application', async () => {
    const {onFieldChange} = renderBridge({applicationId: 'app-9'});

    act(() => {
      void begin(flowOperation);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('does not save until the confirmation releases it', async () => {
    const {save} = renderBridge();

    let pending!: ReturnType<typeof begin>;
    act(() => {
      pending = begin(flowOperation);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => {
      requestSubmit();
    });

    await expect(pending).resolves.toEqual({applicationId: 'app-1', authFlowId: 'flow-2'});
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('returns the same localized message the save bar renders', async () => {
    const {save} = renderBridge({save: vi.fn(() => Promise.resolve(new Error('APP-1039')))});

    let pending!: ReturnType<typeof begin>;
    act(() => {
      pending = begin(flowOperation);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    act(() => {
      requestSubmit();
    });

    await expect(pending).resolves.toEqual({
      code: WebMcpRefusalCodes.REQUEST_FAILED,
      message: 'An application cannot reference a different sign-up flow.',
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
