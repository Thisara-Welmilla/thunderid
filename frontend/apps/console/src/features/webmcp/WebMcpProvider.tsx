// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useMemo, type JSX} from 'react';
import WebMcpJourney from './components/WebMcpJourney';
import getModelContext from './utils/getModelContext';

/**
 * Registers the console's WebMCP tools, once, for the whole app.
 *
 * Mounted alongside the other app-level providers in `App.tsx`. Everything here is additive: when
 * `document.modelContext` / `navigator.modelContext` is absent - every browser except a
 * WebMCP-capable Chrome - this renders nothing at all and the console behaves exactly as it does
 * without this component. Feature components never call `registerTool` themselves, so there is one
 * place that knows which tools exist and one place that tears them down.
 *
 * The detection deliberately lives here rather than inside `WebMcpJourney`: gating the mount, not
 * just the registration, is what keeps the journey's dependencies on the app's contexts out of
 * `App`'s own render path.
 *
 * @returns The guided journey, or nothing when WebMCP is unavailable
 */
export default function WebMcpProvider(): JSX.Element | null {
  const isAvailable = useMemo(() => getModelContext() !== null, []);

  if (!isAvailable) {
    return null;
  }

  return <WebMcpJourney />;
}
