// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {Application} from '@thunderid/configure-applications';
import {useEffect, useRef, useSyncExternalStore} from 'react';
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
 * Options for {@link useGuidedLoginFlowUpdate}.
 *
 * @public
 */
export interface UseGuidedLoginFlowUpdateOptions {
  /**
   * The application currently open, or `undefined` while it loads.
   */
  applicationId: string | undefined;
  /**
   * The edit page's own field-change handler, so the staged change lands in `editedApp` exactly as
   * it would from the Flows tab's Autocomplete.
   */
  onFieldChange: (field: keyof Application, value: unknown) => void;
  /**
   * The edit page's own save handler. Resolves with the error the update failed with, or `null`.
   */
  save: () => Promise<Error | null>;
  /**
   * Resolves a mutation error to the same localized string the save bar renders.
   */
  resolveErrorMessage: (error: Error) => string;
  /**
   * Switches the page to a tab.
   */
  onSelectTab: (tabKey: string) => void;
}

/**
 * Lets a WebMCP `configure_login_flow` call drive the application edit page's Flows tab.
 *
 * Called from `ApplicationEditPage`, because that is where the staged-changes form state lives. It
 * opens the Flows tab, stages the requested flow through the page's own `handleFieldChange`, and
 * then waits: the save runs only once the tool's confirmation dialog is approved. A failure surfaces
 * in the save bar's inline error exactly as a human's failed save would, and the same localized
 * string is returned to the agent.
 *
 * A no-op whenever no guided flow update is in flight.
 *
 * @param options - The edit page's handlers and error resolver
 *
 * @public
 */
export default function useGuidedLoginFlowUpdate({
  applicationId,
  onFieldChange,
  save,
  resolveErrorMessage,
  onSelectTab,
}: UseGuidedLoginFlowUpdateOptions): void {
  const {phase, operation} = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const draft = operation?.kind === 'configureLoginFlow' ? operation.draft : null;

  // The edit page redefines `resolveErrorMessage` on every render, so the submit effect re-runs
  // constantly. This guard, not the dependency list, is what makes the save happen exactly once.
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (phase !== GuidedPhases.PREFILLING || !draft || draft.applicationId !== applicationId) {
      return;
    }

    onSelectTab('flows');
    onFieldChange('authFlowId', draft.flowId);
    markPrefilled();
  }, [phase, draft, applicationId, onFieldChange, onSelectTab]);

  useEffect(() => {
    if (phase !== GuidedPhases.SUBMITTING || !draft) {
      hasSubmittedRef.current = false;
      return;
    }

    if (hasSubmittedRef.current) {
      return;
    }

    hasSubmittedRef.current = true;

    void (async () => {
      const error = await save();

      if (error) {
        settleFailure({code: WebMcpRefusalCodes.REQUEST_FAILED, message: resolveErrorMessage(error)});
        return;
      }

      settleSuccess({applicationId: draft.applicationId, authFlowId: draft.flowId});
    })();
  }, [phase, draft, save, resolveErrorMessage]);
}
