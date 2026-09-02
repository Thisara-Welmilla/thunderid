// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useEffect, type JSX} from 'react';
import ToolReadRunner from './ToolReadRunner';
import WebMcpConfirmDialog from './WebMcpConfirmDialog';
import useSsoJourneyTools from '../hooks/useSsoJourneyTools';
import useToolReads from '../hooks/useToolReads';
import useWebMcpConfirmation from '../hooks/useWebMcpConfirmation';
import getModelContext from '../utils/getModelContext';

/**
 * Registers the "Set up SSO for my app" tools and hosts everything they need on screen.
 *
 * Mounted by `WebMcpProvider` only once WebMCP has been detected. Keeping it behind that check is
 * what lets the tools depend on the console's app-level contexts (`useConfig`, the router, i18n)
 * without those contexts becoming a requirement for rendering `App` at all: in a browser without
 * WebMCP this component never mounts, so it costs nothing and demands nothing.
 *
 * @returns The pending read runners and the confirmation dialog
 */
export default function WebMcpJourney(): JSX.Element {
  const reads = useToolReads();
  const confirmation = useWebMcpConfirmation();
  const tools = useSsoJourneyTools({reads, confirmation});

  useEffect(() => {
    const modelContext = getModelContext();

    if (!modelContext?.registerTool) {
      return undefined;
    }

    const unregisterCallbacks: (() => void)[] = [];

    for (const tool of tools) {
      try {
        // `registerTool` returns nothing in some implementations and a registration handle in
        // others, so the handle is narrowed rather than assumed.
        const registration = modelContext.registerTool(tool) as {unregister?: () => void} | undefined;

        if (typeof registration?.unregister === 'function') {
          unregisterCallbacks.push(registration.unregister);
        } else if (typeof modelContext.unregisterTool === 'function') {
          const {unregisterTool} = modelContext;
          unregisterCallbacks.push(() => unregisterTool(tool.name));
        }
      } catch {
        // A browser exposing a partial or differently-shaped WebMCP must not break the console, so
        // a failed registration drops that one tool rather than the whole journey. Not logged: no
        // `LoggerProvider` is mounted above this component (see `App.tsx`), and a browser declining
        // to register a tool is not something the admin can act on.
      }
    }

    return () => {
      for (const unregister of unregisterCallbacks) {
        try {
          unregister();
        } catch {
          // Teardown is best-effort: the page is going away regardless.
        }
      }
    };
  }, [tools]);

  return (
    <>
      {reads.pending.map((pending) => (
        <ToolReadRunner key={pending.id} id={pending.id} request={pending.request} onSettled={reads.settle} />
      ))}
      <WebMcpConfirmDialog
        request={confirmation.request}
        onConfirm={() => confirmation.settle(true)}
        onCancel={() => confirmation.settle(false)}
      />
    </>
  );
}
