// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Internal flow-input key the backend promotes into the flow's locale, so the
// current UI language rides every /flow/execute call and notifications (email,
// SMS) render in it. The backend validates the tag and drops it if invalid.
export const FLOW_LOCALE_INPUT_KEY = '__locale';

// Merge the active UI language into a flow's inputs under the locale key.
export function withFlowLocale<T extends Record<string, unknown>>(
  inputs: T | undefined,
  language: string | undefined,
): T {
  const next = {...(inputs ?? ({} as T))};
  if (language) {
    (next as Record<string, unknown>)[FLOW_LOCALE_INPUT_KEY] = language;
  }
  return next;
}
