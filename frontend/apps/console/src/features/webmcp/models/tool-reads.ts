// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {Application, ApplicationListResponse} from '@thunderid/configure-applications';
import type {OrganizationUnit} from '@thunderid/configure-organization-units';
import type {FlowDefinitionResponse, FlowListResponse} from '../../flows/models/responses';

/**
 * A read a tool has asked for. Each kind maps onto exactly one of the query hooks the console's own
 * pages use, which is why reads are expressed as a request the provider mounts rather than a
 * function a tool calls: hooks cannot be invoked from a tool callback, and duplicating their
 * `queryFn` here would let the tools' reads drift from the UI's (and from its cache).
 *
 * @public
 */
export type ToolReadRequest =
  | {kind: 'applications'; limit: number}
  | {kind: 'application'; applicationId: string}
  | {kind: 'loginFlows'}
  | {kind: 'loginFlow'; flowId: string}
  | {kind: 'organizationUnits'};

/**
 * Organization unit listing, plus the same "is the choice ambiguous?" signal the creation wizard's
 * Organization Unit step uses.
 *
 * @public
 */
export interface OrganizationUnitsRead {
  hasMultipleOUs: boolean;
  organizationUnits: OrganizationUnit[];
}

/**
 * What each read kind resolves to.
 *
 * @public
 */
export interface ToolReadResults {
  applications: ApplicationListResponse;
  application: Application;
  loginFlows: FlowListResponse;
  loginFlow: FlowDefinitionResponse;
  organizationUnits: OrganizationUnitsRead;
}

/**
 * A read request the provider is currently mounting a hook for.
 *
 * @public
 */
export interface PendingToolRead {
  id: number;
  request: ToolReadRequest;
}
