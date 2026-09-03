// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Derives a flow's URL-friendly handle from its name, matching what the flow wizard's name step
 * generates (`ConfigureFlowName`), so a guided create produces the same handle a human would.
 *
 * @param name - The flow name
 * @returns The derived handle
 *
 * @public
 */
export default function generateFlowHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
