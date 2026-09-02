// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useGetApplication, useGetApplications} from '@thunderid/configure-applications';
import {useGetOrganizationUnits, useHasMultipleOUs} from '@thunderid/configure-organization-units';
import {useEffect, type JSX} from 'react';
import useGetFlowById from '../../flows/api/useGetFlowById';
import useGetFlows from '../../flows/api/useGetFlows';
import {FlowType} from '../../flows/models/flows';
import type {PendingToolRead, ToolReadRequest} from '../models/tool-reads';

/**
 * Reports a settled read back to `useToolReads`.
 */
type OnSettled = (id: number, outcome: {data?: unknown; error?: Error}) => void;

interface ReaderProps {
  id: number;
  onSettled: OnSettled;
}

/**
 * Reports a query result exactly once it has settled.
 *
 * Guards on `isPending` rather than on `data`, so a query that legitimately resolves to
 * `undefined` still settles the tool call instead of hanging it.
 */
function useReportQuery(
  id: number,
  onSettled: OnSettled,
  query: {isPending: boolean; data: unknown; error: Error | null},
): void {
  const {isPending, data, error} = query;

  useEffect(() => {
    if (isPending) {
      return;
    }

    onSettled(id, error ? {error} : {data});
  }, [id, onSettled, isPending, data, error]);
}

function ApplicationsReader({id, onSettled, limit}: ReaderProps & {limit: number}): null {
  useReportQuery(id, onSettled, useGetApplications({limit}));
  return null;
}

function ApplicationReader({id, onSettled, applicationId}: ReaderProps & {applicationId: string}): null {
  useReportQuery(id, onSettled, useGetApplication(applicationId));
  return null;
}

function LoginFlowsReader({id, onSettled}: ReaderProps): null {
  useReportQuery(id, onSettled, useGetFlows({flowType: FlowType.AUTHENTICATION, limit: 100}));
  return null;
}

function LoginFlowReader({id, onSettled, flowId}: ReaderProps & {flowId: string}): null {
  useReportQuery(id, onSettled, useGetFlowById(flowId));
  return null;
}

function OrganizationUnitsReader({id, onSettled}: ReaderProps): null {
  const {hasMultipleOUs, isLoading: isAmbiguityLoading} = useHasMultipleOUs();
  const {data, error, isPending} = useGetOrganizationUnits({limit: 100});

  useEffect(() => {
    if (isPending || isAmbiguityLoading) {
      return;
    }

    if (error) {
      onSettled(id, {error});
      return;
    }

    onSettled(id, {data: {hasMultipleOUs, organizationUnits: data?.organizationUnits ?? []}});
  }, [id, onSettled, isPending, isAmbiguityLoading, error, hasMultipleOUs, data]);

  return null;
}

/**
 * Props for the {@link ToolReadRunner} component.
 */
export interface ToolReadRunnerProps extends PendingToolRead {
  onSettled: OnSettled;
}

/**
 * Runs one read a WebMCP tool asked for, by mounting the very query hook the console's own pages
 * use for that data. Renders nothing.
 *
 * Mounting the hook rather than calling `fetch` is what keeps a tool's reads consistent with what
 * the admin sees: the same query key, the same TanStack Query cache entry, so a subsequent
 * mutation's invalidation refreshes both at once.
 *
 * @param props - Component props
 * @returns Nothing
 */
export default function ToolReadRunner({id, request, onSettled}: ToolReadRunnerProps): JSX.Element | null {
  const typedRequest: ToolReadRequest = request;

  switch (typedRequest.kind) {
    case 'applications':
      return <ApplicationsReader id={id} onSettled={onSettled} limit={typedRequest.limit} />;
    case 'application':
      return <ApplicationReader id={id} onSettled={onSettled} applicationId={typedRequest.applicationId} />;
    case 'loginFlows':
      return <LoginFlowsReader id={id} onSettled={onSettled} />;
    case 'loginFlow':
      return <LoginFlowReader id={id} onSettled={onSettled} flowId={typedRequest.flowId} />;
    case 'organizationUnits':
      return <OrganizationUnitsReader id={id} onSettled={onSettled} />;
    default:
      return null;
  }
}
