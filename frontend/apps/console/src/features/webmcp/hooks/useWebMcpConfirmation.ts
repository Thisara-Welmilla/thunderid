// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useCallback, useRef, useState} from 'react';
import type {ConfirmationRequest} from '../models/confirmation';
import getModelContext from '../utils/getModelContext';

/**
 * The confirmation gate every mutating tool passes through.
 *
 * @public
 */
export interface WebMcpConfirmation {
  /**
   * The pending request, rendered by `WebMcpConfirmDialog`.
   */
  request: ConfirmationRequest | null;
  /**
   * Shows the request and resolves once the admin answers. Resolves `false` if another
   * confirmation is already on screen, so two tool calls can never share one approval.
   */
  confirm: (request: ConfirmationRequest) => Promise<boolean>;
  /**
   * Answers the pending request.
   */
  settle: (approved: boolean) => void;
}

/**
 * Gates a mutating tool behind an explicit, in-console confirmation.
 *
 * `requestUserInteraction()` is called first when the browser exposes it, which hands control back
 * to the admin and brings this tab forward. It is not sufficient on its own and is optional in
 * every implementation seen so far, so the dialog is always rendered: only the console knows, and
 * can show, the exact payload about to be submitted.
 *
 * @returns The confirmation gate
 *
 * @public
 */
export default function useWebMcpConfirmation(): WebMcpConfirmation {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const pendingRef = useRef<((approved: boolean) => void) | null>(null);

  const confirm = useCallback(async (next: ConfirmationRequest): Promise<boolean> => {
    if (pendingRef.current) {
      return false;
    }

    await getModelContext()?.requestUserInteraction?.();

    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setRequest(next);
    });
  }, []);

  const settle = useCallback((approved: boolean): void => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    resolve?.(approved);
  }, []);

  return {request, confirm, settle};
}
