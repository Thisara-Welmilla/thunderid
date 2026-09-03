// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Models shared by the "Set up SSO for my app" WebMCP journey.
 *
 * @public
 */

/**
 * Machine-readable reasons a tool refuses to act. The agent narrates these, so each one names a
 * single, correctable condition rather than a generic failure.
 *
 * @public
 */
export const WebMcpRefusalCodes = {
  /** The `template` input is not one the journey may create from. */
  TEMPLATE_NOT_ALLOWED: 'TEMPLATE_NOT_ALLOWED',
  /** The application name is missing or too long. */
  INVALID_NAME: 'INVALID_NAME',
  /** No redirect URI was supplied. */
  REDIRECT_URI_REQUIRED: 'REDIRECT_URI_REQUIRED',
  /** A redirect URI is not a parseable absolute URI. */
  REDIRECT_URI_MALFORMED: 'REDIRECT_URI_MALFORMED',
  /** A redirect URI contains a wildcard. */
  REDIRECT_URI_WILDCARD: 'REDIRECT_URI_WILDCARD',
  /** A redirect URI uses a scheme other than http or https. */
  REDIRECT_URI_SCHEME: 'REDIRECT_URI_SCHEME',
  /** A redirect URI uses plain http against a non-loopback host. */
  REDIRECT_URI_INSECURE: 'REDIRECT_URI_INSECURE',
  /** A redirect URI carries a fragment. */
  REDIRECT_URI_FRAGMENT: 'REDIRECT_URI_FRAGMENT',
  /** More than one organization unit exists and none was named. */
  ORGANIZATION_UNIT_AMBIGUOUS: 'ORGANIZATION_UNIT_AMBIGUOUS',
  /** The named organization unit does not exist. */
  ORGANIZATION_UNIT_NOT_FOUND: 'ORGANIZATION_UNIT_NOT_FOUND',
  /** The named application does not exist. */
  APPLICATION_NOT_FOUND: 'APPLICATION_NOT_FOUND',
  /** The application is declarative and cannot be changed from the console. */
  APPLICATION_READ_ONLY: 'APPLICATION_READ_ONLY',
  /** The application has no grant that signs an end user in. */
  APPLICATION_NOT_USER_FACING: 'APPLICATION_NOT_USER_FACING',
  /** The application has no usable redirect URI yet. */
  APPLICATION_NO_REDIRECT_URI: 'APPLICATION_NO_REDIRECT_URI',
  /** The application has no OAuth2 client identifier. */
  APPLICATION_NO_CLIENT_ID: 'APPLICATION_NO_CLIENT_ID',
  /** The named flow does not exist. */
  FLOW_NOT_FOUND: 'FLOW_NOT_FOUND',
  /** The named flow is not an authentication flow. */
  FLOW_WRONG_TYPE: 'FLOW_WRONG_TYPE',
  /** The requested flow template is not one this journey creates from. */
  FLOW_TEMPLATE_NOT_ALLOWED: 'FLOW_TEMPLATE_NOT_ALLOWED',
  /** The admin declined the confirmation. */
  DECLINED: 'DECLINED',
  /** The console did not reach the expected page in time. */
  UI_NOT_READY: 'UI_NOT_READY',
  /** The requested console section does not exist. */
  SECTION_NOT_FOUND: 'SECTION_NOT_FOUND',
  /** The backend rejected the write. Carries the same message the console renders inline. */
  REQUEST_FAILED: 'REQUEST_FAILED',
} as const;

/**
 * Refusal reason type.
 *
 * @public
 */
export type WebMcpRefusalCode = (typeof WebMcpRefusalCodes)[keyof typeof WebMcpRefusalCodes];

/**
 * A refusal, returned to the agent as a structured error rather than thrown.
 *
 * @public
 */
export interface WebMcpRefusal {
  code: WebMcpRefusalCode;
  message: string;
  /**
   * Extra context the agent can use to fix the call and re-narrate, e.g. the offending URI or the
   * organization units it must choose between.
   */
  details?: Record<string, unknown>;
}

/**
 * The application the guided journey is about to create, after validation.
 *
 * Grant types, PKCE, public-client and token-endpoint auth method are deliberately absent: they
 * come from the chosen template's own defaults, which the wizard applies.
 *
 * @public
 */
export interface GuidedApplicationDraft {
  /** Template gallery value, e.g. `REACT`. */
  template: string;
  /** The template's own id, e.g. `react`. */
  templateId: string;
  /** Template display name, for the confirmation dialog. */
  templateDisplayName: string;
  name: string;
  redirectUris: string[];
  /** Resolved organization unit, or `null` when the deployment has exactly one. */
  ouId: string | null;
  /** Organization unit name, for the confirmation dialog. */
  ouName: string | null;
}

/**
 * The login flow the guided journey is about to attach to an existing application.
 *
 * @public
 */
export interface GuidedFlowUpdateDraft {
  applicationId: string;
  applicationName: string;
  flowId: string;
  flowName: string;
  /**
   * The flow currently configured, so the confirmation dialog can show what is being replaced.
   */
  currentFlowId?: string;
}

/**
 * The login flow the guided journey is about to create from a template.
 *
 * @public
 */
export interface GuidedFlowDraft {
  /** The flow's display name. */
  name: string;
  /** URL-friendly handle, derived from the name. */
  handle: string;
  /** The template's `type`, e.g. `CREDENTIALS_AUTH`, used to resolve the template in the wizard. */
  templateType: string;
  /** The template's display label, for the confirmation dialog. */
  templateLabel: string;
  /** The flow type. Always `AUTHENTICATION` for this journey. */
  flowType: string;
}

/**
 * The outcome of a successful mutating tool call.
 *
 * @public
 */
export interface GuidedApplicationResult {
  applicationId: string;
  clientId?: string;
  authFlowId?: string;
}

/**
 * The outcome of a successful guided flow creation.
 *
 * @public
 */
export interface GuidedFlowResult {
  flowId: string;
}

/**
 * A guided operation the console UI has to carry out on a tool's behalf.
 *
 * @public
 */
export type GuidedOperation =
  | {kind: 'createApplication'; draft: GuidedApplicationDraft}
  | {kind: 'configureLoginFlow'; draft: GuidedFlowUpdateDraft}
  | {kind: 'createLoginFlow'; draft: GuidedFlowDraft};
