// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, renderHook, waitFor} from '@testing-library/react';
import type {Application} from '@thunderid/configure-applications';
import type {PropsWithChildren} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import ApplicationCreateProvider from '../../applications/contexts/ApplicationCreate/ApplicationCreateProvider';
import useApplicationCreate from '../../applications/contexts/ApplicationCreate/useApplicationCreate';
import {ApplicationCreateFlowStep} from '../../applications/models/application-create-flow';
import type {ApplicationTemplate} from '../../applications/models/application-templates';
import useGuidedApplicationDraft from '../hooks/useGuidedApplicationDraft';
import {WebMcpRefusalCodes, type GuidedApplicationDraft} from '../models/journey';
import {GuidedPhases, begin, getSnapshot, requestSubmit, settleFailure} from '../store/guidedJourneyStore';

vi.mock('@thunderid/configure-applications', async () => {
  const actual = await vi.importActual<typeof import('@thunderid/configure-applications')>(
    '@thunderid/configure-applications',
  );
  return {...actual, useGetApplications: () => ({data: undefined, isLoading: false})};
});

const reactTemplate = {
  id: 'react',
  displayName: 'React',
  type: 'browser',
  creationFlow: {
    steps: ['ORGANIZATION_UNIT', 'DETAILS', 'SECURITY', 'DESIGN', 'CONFIGURE', 'COMPLETE'],
    previewSteps: [],
  },
} as unknown as ApplicationTemplate;

const draft: GuidedApplicationDraft = {
  template: 'REACT',
  templateId: 'react',
  templateDisplayName: 'React',
  name: 'Storefront',
  redirectUris: ['https://app.example.com/callback', 'https://app.example.com/silent'],
  ouId: 'ou-1',
  ouName: 'Root',
};

const wrapper = ({children}: PropsWithChildren) => <ApplicationCreateProvider>{children}</ApplicationCreateProvider>;

function renderBridge(options: {submit: () => void; createdApplication?: Application}) {
  return renderHook(
    () => {
      const context = useApplicationCreate();
      useGuidedApplicationDraft({submit: options.submit, createdApplication: options.createdApplication});
      return context;
    },
    {wrapper},
  );
}

afterEach(() => {
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'test cleanup'});
  }
});

describe('useGuidedApplicationDraft', () => {
  it('does nothing when no tool call is in flight', () => {
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    expect(submit).not.toHaveBeenCalled();
    expect(result.current.appName).toBe('');
  });

  it('waits for the template gallery hand-off before filling the form', async () => {
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    act(() => {
      void begin({kind: 'createApplication', draft});
    });

    // No template selected yet, so the wizard is still configured for something else.
    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    expect(result.current.appName).toBe('');
  });

  it('fills the wizard through its own setters once the template is selected', async () => {
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    act(() => {
      void begin({kind: 'createApplication', draft});
      result.current.setSelectedTemplateConfig(reactTemplate);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });

    expect(result.current.appName).toBe('Storefront');
    expect(result.current.ouId).toBe('ou-1');
    // The first URI replaces the template's placeholder; the rest are merged on top.
    expect(result.current.callbackUrlFromConfig).toBe('https://app.example.com/callback');
    expect(result.current.redirectUris).toEqual(['https://app.example.com/silent']);
    expect(result.current.hostingUrl).toBe('https://app.example.com');
    expect(result.current.currentStep).toBe(ApplicationCreateFlowStep.CONFIGURE);
  });

  it('does not submit until the confirmation releases it', async () => {
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    act(() => {
      void begin({kind: 'createApplication', draft});
      result.current.setSelectedTemplateConfig(reactTemplate);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    expect(submit).not.toHaveBeenCalled();

    act(() => {
      requestSubmit();
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
  });

  it('submits exactly once even though the wizard redefines its submit handler each render', async () => {
    const submit = vi.fn();
    const {result, rerender} = renderBridge({submit});

    act(() => {
      void begin({kind: 'createApplication', draft});
      result.current.setSelectedTemplateConfig(reactTemplate);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    act(() => {
      requestSubmit();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });

    rerender();
    rerender();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('ignores an operation while the previous run still has the form filled in', async () => {
    // Regression: a second tool call arrives while the wizard from the first is still mounted. The
    // template gallery resets the creation context on its way back in, so filling the outgoing
    // wizard here loses the name and submits an application without one.
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    act(() => {
      result.current.setSelectedTemplateConfig(reactTemplate);
      result.current.setAppName('Left over from the last call');
    });

    act(() => {
      void begin({kind: 'createApplication', draft});
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    expect(result.current.appName).toBe('Left over from the last call');

    // Once the gallery has reset the form, the same operation is picked up.
    act(() => {
      result.current.setAppName('');
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    expect(result.current.appName).toBe('Storefront');
  });

  it('reports the wizard inline error to the agent rather than inventing its own', async () => {
    const submit = vi.fn();
    const {result} = renderBridge({submit});

    let pending!: ReturnType<typeof begin>;
    act(() => {
      pending = begin({kind: 'createApplication', draft});
      result.current.setSelectedTemplateConfig(reactTemplate);
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.READY);
    });
    act(() => {
      requestSubmit();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });

    act(() => {
      result.current.setError('An application with this name already exists.');
    });

    await expect(pending).resolves.toEqual({
      code: WebMcpRefusalCodes.REQUEST_FAILED,
      message: 'An application with this name already exists.',
    });
  });
});
