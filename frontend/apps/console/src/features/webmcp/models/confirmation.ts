// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * A single labelled fact shown in the confirmation dialog.
 *
 * @public
 */
export interface ConfirmationDetail {
  label: string;
  value: string;
}

/**
 * What a mutating tool asks the admin to confirm before it writes anything.
 *
 * @public
 */
export interface ConfirmationRequest {
  title: string;
  description: string;
  /**
   * Exactly what is about to be created or changed, so the admin approves the real payload rather
   * than the agent's summary of it.
   */
  details: ConfirmationDetail[];
  confirmLabel: string;
}
