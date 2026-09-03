// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useEffect, useRef, useSyncExternalStore} from 'react';
import useGetFlowsMeta from '../../flows/api/useGetFlowsMeta';
import {FlowType} from '../../flows/models/flows';
import type {FlowTemplate} from '../../flows/models/templates';
import {WebMcpRefusalCodes} from '../models/journey';
import {
  GuidedPhases,
  getSnapshot,
  markPrefilled,
  settleFailure,
  settleSuccess,
  subscribe,
} from '../store/guidedJourneyStore';
import generateFlowHandle from '../utils/generateFlowHandle';
import {typeInto} from '../utils/pacing';
import {getWebMcpTimings} from '../utils/webMcpSpeed';

/**
 * Options for {@link useGuidedFlowDraft}.
 *
 * @public
 */
export interface UseGuidedFlowDraftOptions {
  /** Selects the authentication template the draft names. */
  applyTemplate: (flowType: FlowType, template: FlowTemplate) => void;
  /** Fills in the flow name and handle, and marks the name step ready. */
  applyName: (name: string, handle: string) => void;
  /** Moves the wizard to its final "Details" step, so the admin sees the filled-in form. */
  openConfigureStep: () => void;
  /** The wizard's own create handler, run only after the admin confirms. */
  submit: () => void;
  /** The id of the flow the wizard's create mutation returned, if any. */
  createdFlowId: string | undefined;
  /** The wizard's inline error string, if the create failed. */
  error: string | null;
}

/**
 * Lets a WebMCP `create_login_flow` call drive the real flow-creation wizard.
 *
 * Called from `FlowCreatePage`, the only place the wizard's form state exists. It takes the draft a
 * tool left in the guided journey store, resolves the named authentication template, writes it plus
 * the flow name through the wizard's own setters, moves the wizard to its last step so the admin sees
 * the filled-in form, then waits: nothing is submitted until the tool's confirmation dialog is
 * approved and the store moves to `SUBMITTING`. On success it settles with the created flow's id; on
 * failure it settles with the wizard's own inline error, exactly what a human would have seen.
 *
 * A no-op whenever no guided flow creation is in flight, which is every case except this one tool.
 *
 * @param options - The wizard's setters, submit handler, create result, and error
 *
 * @public
 */
export default function useGuidedFlowDraft({
  applyTemplate,
  applyName,
  openConfigureStep,
  submit,
  createdFlowId,
  error,
}: UseGuidedFlowDraftOptions): void {
  const {phase, operation} = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const draft = operation?.kind === 'createLoginFlow' ? operation.draft : null;

  const {data} = useGetFlowsMeta({flowType: FlowType.AUTHENTICATION});
  const templates = data.templates;

  const hasPrefilledRef = useRef(false);
  const hasSubmittedRef = useRef(false);

  // Stage the draft: resolve the template, fill the form, open the last step, then mark prefilled so
  // the tool can raise its confirmation dialog.
  useEffect(() => {
    if (phase !== GuidedPhases.PREFILLING || !draft || hasPrefilledRef.current) {
      return;
    }

    const template = templates.find((entry) => entry.type === draft.templateType);
    if (!template) {
      // Templates are bundled and synchronous, so a miss here means the tool validated against a set
      // that no longer contains this type. Fail rather than hang the wizard on a template it cannot
      // find.
      settleFailure({
        code: WebMcpRefusalCodes.FLOW_TEMPLATE_NOT_ALLOWED,
        message: `The "${draft.templateType}" flow template is no longer available.`,
      });
      hasPrefilledRef.current = true;
      return;
    }

    hasPrefilledRef.current = true;
    applyTemplate(FlowType.AUTHENTICATION, template);
    openConfigureStep();

    const timings = getWebMcpTimings();
    if (!timings.enabled) {
      applyName(draft.name, draft.handle);
      markPrefilled();
      return undefined;
    }

    // Paced: type the name out, deriving the handle as it grows, then raise the confirmation.
    let cancelled = false;
    void (async () => {
      await typeInto(
        (value) => {
          if (!cancelled) {
            applyName(value, generateFlowHandle(value));
          }
        },
        draft.name,
        timings.perCharMs,
      );
      if (!cancelled) {
        markPrefilled();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, draft, templates, applyTemplate, applyName, openConfigureStep]);

  // Release the reused guard once the operation is over, so the next tool call stages afresh.
  useEffect(() => {
    if (phase === GuidedPhases.IDLE) {
      hasPrefilledRef.current = false;
    }
  }, [phase]);

  // Submit exactly once, only after the admin has confirmed and the store has moved to SUBMITTING.
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

  // Settle with the created flow's id.
  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING || !createdFlowId) {
      return;
    }
    settleSuccess({flowId: createdFlowId});
  }, [phase, createdFlowId]);

  // Settle with the wizard's own inline error, the same message a human would see.
  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING || !error) {
      return;
    }
    settleFailure({code: WebMcpRefusalCodes.REQUEST_FAILED, message: error});
  }, [phase, error]);
}
