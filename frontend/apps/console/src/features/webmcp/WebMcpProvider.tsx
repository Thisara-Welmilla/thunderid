// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useEffect, useState, type JSX} from 'react';
import WebMcpJourney from './components/WebMcpJourney';
import getModelContext from './utils/getModelContext';

/**
 * How long to keep watching for a late-injected WebMCP surface, and how often to look. An extension
 * bridge attaches its content script asynchronously, so `modelContext` can appear a beat after the
 * console has mounted; a one-time check at mount would miss it and register nothing until a manual
 * reload. Polling briefly closes that gap without leaving a timer running for the life of the tab.
 *
 * @internal
 */
const DETECT_INTERVAL_MS = 400;
const DETECT_TIMEOUT_MS = 15_000;

/**
 * Reports whether WebMCP is usable, now or once a bridge injects it. Starts from the value at mount
 * and, if absent, polls until it appears or the detection window closes.
 *
 * @returns Whether tools can be published
 */
function useWebMcpAvailable(): boolean {
  const [available, setAvailable] = useState(() => getModelContext() !== null);

  useEffect(() => {
    if (available) {
      return undefined;
    }

    const interval = setInterval(() => {
      if (getModelContext() !== null) {
        setAvailable(true);
      }
    }, DETECT_INTERVAL_MS);

    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, DETECT_TIMEOUT_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [available]);

  return available;
}

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
  const isAvailable = useWebMcpAvailable();

  if (!isAvailable) {
    return null;
  }

  return <WebMcpJourney />;
}
