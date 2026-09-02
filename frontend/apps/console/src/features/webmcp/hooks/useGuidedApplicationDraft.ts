// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {Application} from '@thunderid/configure-applications';
import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import useApplicationCreate from '../../applications/contexts/ApplicationCreate/useApplicationCreate';
import {ApplicationCreateFlowStep} from '../../applications/models/application-create-flow';
import resolveCreationFlow from '../../applications/utils/resolveCreationFlow';
import {WebMcpRefusalCodes} from '../models/journey';
import {
  GuidedPhases,
  getSnapshot,
  markPrefilled,
  settleFailure,
  settleSuccess,
  subscribe,
} from '../store/guidedJourneyStore';

/**
 * Options for {@link useGuidedApplicationDraft}.
 *
 * @public
 */
export interface UseGuidedApplicationDraftOptions {
  /**
   * The wizard's own submit handler (`ensureFlowAndCreateApplication`). Called only after the admin
   * has confirmed, so the guided journey creates the application through exactly the same code path
   * as a human pressing Create.
   */
  submit: () => void;
  /**
   * The application the wizard's create mutation returned, if any.
   */
  createdApplication: Application | undefined;
}

/**
 * Lets a WebMCP `create_application` call drive the real creation wizard.
 *
 * Called from `ApplicationCreatePage`, inside `ApplicationCreateProvider`, because that is the only
 * place the wizard's form state exists. It takes the draft a tool left in the guided journey store,
 * writes it through the wizard's own context setters, moves the wizard to its last step so the
 * admin sees the filled-in form, and then waits: nothing is submitted until the tool's confirmation
 * dialog is approved and the store moves to `SUBMITTING`.
 *
 * Failures are not reported separately to the agent. The wizard's existing `error` state renders the
 * localized message inline above the Create button exactly as it would for a human's failed submit,
 * and that same string is what the tool returns.
 *
 * A no-op whenever no guided creation is in flight, which is every case except a WebMCP tool call.
 *
 * @param options - The wizard's submit handler and create result
 *
 * @public
 */
export default function useGuidedApplicationDraft({
  submit,
  createdApplication,
}: UseGuidedApplicationDraftOptions): void {
  const {phase, operation} = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const draft = operation?.kind === 'createApplication' ? operation.draft : null;
  const {
    selectedTemplateConfig,
    currentStep,
    appName,
    setAppName,
    setCallbackUrlFromConfig,
    setRedirectUris,
    setHostingUrl,
    setOuId,
    setCurrentStep,
    error,
    setError,
  } = useApplicationCreate();

  // The wizard redefines `submit` on every render, so the submit effect re-runs constantly. This
  // guard, not the dependency list, is what makes the submission happen exactly once.
  const hasSubmittedRef = useRef(false);
  const hasOpenedConfigurationStepRef = useRef(false);

  const targetStep = useMemo(() => {
    if (!selectedTemplateConfig) {
      return null;
    }

    // The last step before COMPLETE, so the admin sees the whole filled-in form rather than a
    // half-finished wizard while the confirmation is up.
    const steps = resolveCreationFlow(selectedTemplateConfig).steps;
    return [...steps].reverse().find((step) => step !== ApplicationCreateFlowStep.COMPLETE) ?? null;
  }, [selectedTemplateConfig]);

  // Phase one: everything the Configuration step does not own, then open that step.
  useEffect(() => {
    if (phase !== GuidedPhases.PREFILLING || !draft || hasOpenedConfigurationStepRef.current) {
      return;
    }

    // The template gallery seeds the shared creation context before handing off to the wizard, so
    // wait for that hand-off rather than filling a form still configured for another template.
    if (selectedTemplateConfig?.id !== draft.templateId) {
      return;
    }

    // And wait for the wizard this tool call navigated to, not the one left on screen by the
    // previous call. `ApplicationTemplateSelectPage.handleTemplateSelect` calls the creation
    // context's `reset()` before seeding the new template, so a second tool call would otherwise
    // fill in the outgoing wizard, have that reset wipe it, and submit an application with no name.
    // An empty `appName` is what "freshly reset and ready to be filled" looks like.
    if (appName !== '') {
      return;
    }

    setError(null);
    setAppName(draft.name);
    setHostingUrl(new URL(draft.redirectUris[0]).origin);

    if (draft.ouId) {
      setOuId(draft.ouId);
    }

    if (targetStep) {
      setCurrentStep(targetStep);
    }

    hasOpenedConfigurationStepRef.current = true;
  }, [
    phase,
    draft,
    selectedTemplateConfig,
    targetStep,
    appName,
    setAppName,
    setHostingUrl,
    setOuId,
    setCurrentStep,
    setError,
  ]);

  // Phase two: the redirect URIs, once the Configuration step is mounted.
  //
  // `ConfigureDetails` keeps its own react-hook-form state and, on mount, pushes its empty
  // `hostingUrl` field up through `onCallbackUrlChange` because its `callbackMode` defaults to
  // "same as the hosting URL". Writing the redirect URIs in phase one therefore gets wiped the
  // moment that step renders, and the application is created with the template's placeholder
  // redirect URI instead of the requested one. Writing them after the step has initialized is what
  // makes them stick: that effect does not run again unless the admin edits the field.
  useEffect(() => {
    if (
      phase !== GuidedPhases.PREFILLING ||
      !draft ||
      !hasOpenedConfigurationStepRef.current ||
      currentStep !== targetStep
    ) {
      return;
    }

    const [primaryRedirectUri, ...additionalRedirectUris] = draft.redirectUris;

    // The primary URI replaces the template's placeholder rather than adding to it; the rest are
    // merged on top of that.
    setCallbackUrlFromConfig(primaryRedirectUri);
    setRedirectUris(additionalRedirectUris);

    markPrefilled();
  }, [phase, draft, currentStep, targetStep, setCallbackUrlFromConfig, setRedirectUris]);

  // A finished or abandoned operation must not leave the phase-one guard latched, or the next tool
  // call would skip straight to phase two with a stale form.
  useEffect(() => {
    if (phase === GuidedPhases.IDLE) {
      hasOpenedConfigurationStepRef.current = false;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING) {
      hasSubmittedRef.current = false;
      return;
    }

    if (hasSubmittedRef.current) {
      return;
    }

    hasSubmittedRef.current = true;
    submit();
  }, [phase, submit]);

  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING || !createdApplication) {
      return;
    }

    const clientId = createdApplication.inboundAuthConfig?.find((config) => config.type === 'oauth2')?.config?.clientId;

    settleSuccess({
      applicationId: createdApplication.id,
      clientId,
      authFlowId: createdApplication.authFlowId,
    });
  }, [phase, createdApplication]);

  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING || !error) {
      return;
    }

    settleFailure({code: WebMcpRefusalCodes.REQUEST_FAILED, message: error});
  }, [phase, error]);
}
