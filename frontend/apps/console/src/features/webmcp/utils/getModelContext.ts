// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {WebMcpModelContext} from '../models/webmcp';

/**
 * Resolves the browser's WebMCP entry point, preferring the document-scoped surface over the
 * navigator-scoped one.
 *
 * Returns `null` when WebMCP is absent, or present but without a usable `registerTool`, so callers
 * register nothing and the console behaves exactly as it does today. Chrome-only by design; no
 * attempt is made to polyfill Firefox or Safari.
 *
 * @returns The model context, or `null` when this browser cannot register tools
 *
 * @public
 */
export default function getModelContext(): WebMcpModelContext | null {
  if (typeof document === 'undefined' && typeof navigator === 'undefined') {
    return null;
  }

  const context: WebMcpModelContext | undefined =
    (typeof document !== 'undefined' ? document.modelContext : undefined) ??
    (typeof navigator !== 'undefined' ? navigator.modelContext : undefined);

  if (!context || typeof context.registerTool !== 'function') {
    return null;
  }

  return context;
}
