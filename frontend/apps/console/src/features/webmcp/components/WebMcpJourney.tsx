// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useMemo, type JSX} from 'react';
import ToolReadRunner from './ToolReadRunner';
import WebMcpActionSpotlight from './WebMcpActionSpotlight';
import WebMcpConfirmDialog from './WebMcpConfirmDialog';
import WebMcpCursor from './WebMcpCursor';
import useConsoleNavigationTools from '../hooks/useConsoleNavigationTools';
import useRegisterWebMcpTools from '../hooks/useRegisterWebMcpTools';
import useSsoJourneyTools from '../hooks/useSsoJourneyTools';
import useToolReads from '../hooks/useToolReads';
import useWebMcpConfirmation from '../hooks/useWebMcpConfirmation';

/**
 * Registers the console's WebMCP tools and hosts everything they need on screen: the navigation
 * tools that let an agent move around the console like a quickstart, and the "Set up SSO for my app"
 * journey tools.
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
  const ssoTools = useSsoJourneyTools({reads, confirmation});
  const navigationTools = useConsoleNavigationTools();
  const tools = useMemo(() => [...navigationTools, ...ssoTools], [navigationTools, ssoTools]);

  useRegisterWebMcpTools(tools);

  return (
    <>
      {reads.pending.map((pending) => (
        <ToolReadRunner key={pending.id} id={pending.id} request={pending.request} onSettled={reads.settle} />
      ))}
      <WebMcpActionSpotlight />
      <WebMcpCursor />
      <WebMcpConfirmDialog
        request={confirmation.request}
        onConfirm={() => confirmation.settle(true)}
        onCancel={() => confirmation.settle(false)}
      />
    </>
  );
}
