// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {Application, OAuth2Config} from '@thunderid/configure-applications';
import {useConfig} from '@thunderid/contexts';
import {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';
import type {ToolReads} from './useToolReads';
import type {WebMcpConfirmation} from './useWebMcpConfirmation';
import RouteConfig from '../../../configs/RouteConfig';
import ApplicationConstants from '../../applications/constants/application-constants';
import {hasUserAccess} from '../../applications/utils/oauth2Rules';
import useGetFlowsMeta from '../../flows/api/useGetFlowsMeta';
import {FlowType} from '../../flows/models/flows';
import WebMcpTools from '../constants/webmcp-tools';
import {WebMcpRefusalCodes, type GuidedApplicationDraft, type WebMcpRefusal} from '../models/journey';
import type {WebMcpToolDescriptor, WebMcpToolResult} from '../models/webmcp';
import {begin, isRefusal, requestSubmit, settleFailure, waitUntilPrefilled} from '../store/guidedJourneyStore';
import {announce} from '../store/webMcpActivityStore';
import buildTestLoginUrl from '../utils/buildTestLoginUrl';
import {pointAtConfirmButton} from '../utils/cursorControl';
import generateFlowHandle from '../utils/generateFlowHandle';
import getSsoTemplateOptions from '../utils/getSsoTemplateOptions';
import {sleep} from '../utils/pacing';
import {asRefusal, toolRefusal, toolSuccess} from '../utils/toolResults';
import validateRedirectUris from '../utils/validateRedirectUris';
import {getWebMcpTimings} from '../utils/webMcpSpeed';

/**
 * How long a tool waits for the console to reach the page it navigated to and take the draft. Long
 * enough for a lazily-loaded route chunk on a cold cache, short enough that a blocked navigation
 * surfaces as a refusal rather than a hung tool call.
 *
 * @internal
 */
const UI_READY_TIMEOUT_MS = 15_000;

function getOAuth2Config(application: Application): OAuth2Config | undefined {
  return application.inboundAuthConfig?.find((config) => config.type === 'oauth2')?.config;
}


/**
 * Everything about an application a read tool is allowed to hand back. The client secret is
 * excluded: the backend masks it in GET responses, and it must not travel to an agent even when a
 * create response briefly carries one.
 */
function toApplicationSummary(application: Application): Record<string, unknown> {
  const oauth2 = getOAuth2Config(application);

  return {
    id: application.id,
    name: application.name,
    description: application.description,
    type: application.type,
    template: application.template,
    ouId: application.ouId,
    authFlowId: application.authFlowId,
    isReadOnly: application.isReadOnly === true,
    oauth2: oauth2
      ? {
          clientId: oauth2.clientId,
          redirectUris: oauth2.redirectUris ?? [],
          grantTypes: oauth2.grantTypes ?? [],
          responseTypes: oauth2.responseTypes ?? [],
          pkceRequired: oauth2.pkceRequired === true,
          publicClient: oauth2.publicClient === true,
          tokenEndpointAuthMethod: oauth2.tokenEndpointAuthMethod,
        }
      : null,
  };
}

/**
 * Options for {@link useSsoJourneyTools}.
 *
 * @public
 */
export interface UseSsoJourneyToolsOptions {
  reads: ToolReads;
  confirmation: WebMcpConfirmation;
}

/**
 * Builds the WebMCP tools for the "Set up SSO for my app" journey.
 *
 * Each tool is one step a human would take, so the agent's sequence of calls mirrors, and can
 * narrate, the sequence of screens: find the application, create one, attach a login flow, try
 * signing in. Reads are marked `readOnlyHint`, matching the annotations the backend Go tools already
 * carry (`backend/internal/ou/tools.go`). Every write navigates the admin's own console to the page
 * that owns the change, stages it in that page's real form state, and submits through that page's
 * own handler only after an explicit confirmation.
 *
 * Tool descriptions and refusal messages are plain English rather than translated: they are read by
 * the calling agent, not rendered in the UI. Everything the admin actually sees - the confirmation
 * dialog, and every inline error a failed write produces - goes through `t` as usual.
 *
 * @param options - The read gate and the confirmation gate
 * @returns The tools to register
 *
 * @public
 */
export default function useSsoJourneyTools({reads, confirmation}: UseSsoJourneyToolsOptions): WebMcpToolDescriptor[] {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const {getServerUrl} = useConfig();
  const {read} = reads;
  const {confirm} = confirmation;

  const templateOptions = useMemo(() => getSsoTemplateOptions(), []);

  const {data: flowsMeta} = useGetFlowsMeta({flowType: FlowType.AUTHENTICATION});
  // Every bundled authentication template except the empty "BLANK" one, which has no steps to run.
  const authFlowTemplates = useMemo(
    () => flowsMeta.templates.filter((template) => template.type !== 'BLANK'),
    [flowsMeta.templates],
  );
  const authFlowTemplateTypes = useMemo(() => authFlowTemplates.map((template) => template.type), [authFlowTemplates]);

  /**
   * Resolves the organization unit the application should be created in.
   *
   * The repository has no sandbox or demo organization unit concept, so there is nothing safe to
   * default to when the deployment has more than one: acting in whichever unit the admin happens to
   * be looking at would put a real application somewhere they did not choose. The tool refuses and
   * hands back the list instead, which is also what the wizard's own Organization Unit step does.
   */
  const resolveOrganizationUnit = useCallback(
    async (
      requestedOuId: string | undefined,
    ): Promise<{ouId: string | null; ouName: string | null} | WebMcpRefusal> => {
      const {hasMultipleOUs, organizationUnits} = await read({kind: 'organizationUnits'});

      if (requestedOuId) {
        const match = organizationUnits.find((unit) => unit.id === requestedOuId || unit.handle === requestedOuId);

        if (!match) {
          return {
            code: WebMcpRefusalCodes.ORGANIZATION_UNIT_NOT_FOUND,
            message: `No organization unit matches "${requestedOuId}".`,
            details: {
              organizationUnits: organizationUnits.map((unit) => ({id: unit.id, handle: unit.handle, name: unit.name})),
            },
          };
        }

        return {ouId: match.id, ouName: match.name};
      }

      if (!hasMultipleOUs) {
        return {ouId: null, ouName: organizationUnits[0]?.name ?? null};
      }

      return {
        code: WebMcpRefusalCodes.ORGANIZATION_UNIT_AMBIGUOUS,
        message:
          'This deployment has more than one organization unit, and there is no demo or sandbox unit to fall ' +
          'back on. Ask which organization unit the application belongs in and pass it as ouId.',
        details: {
          organizationUnits: organizationUnits.map((unit) => ({id: unit.id, handle: unit.handle, name: unit.name})),
        },
      };
    },
    [read],
  );

  const listOrganizationUnits = useCallback(async (): Promise<WebMcpToolResult> => {
    try {
      const {hasMultipleOUs, organizationUnits} = await read({kind: 'organizationUnits'});

      return toolSuccess({
        requiresExplicitChoice: hasMultipleOUs,
        organizationUnits: organizationUnits.map((unit) => ({
          id: unit.id,
          handle: unit.handle,
          name: unit.name,
          description: unit.description,
        })),
      });
    } catch (error) {
      return toolRefusal(
        asRefusal(error, {
          code: WebMcpRefusalCodes.REQUEST_FAILED,
          message: 'Could not list organization units.',
        }),
      );
    }
  }, [read]);

  const searchApplications = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const requestedLimit = typeof args.limit === 'number' ? args.limit : 30;
      const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);

      try {
        const response = await read({kind: 'applications', limit});
        // The list endpoint takes only limit/offset, so the name filter is applied here rather than
        // pretending the server supports a search parameter.
        const applications = (response.applications ?? []).filter(
          (application) => !query || application.name.toLowerCase().includes(query),
        );

        return toolSuccess({
          totalResults: response.totalResults,
          matched: applications.length,
          applications: applications.map((application) => ({
            id: application.id,
            name: application.name,
            description: application.description,
            type: application.type,
            template: application.template,
            clientId: application.clientId,
            authFlowId: application.authFlowId,
          })),
        });
      } catch (error) {
        return toolRefusal(
          asRefusal(error, {code: WebMcpRefusalCodes.REQUEST_FAILED, message: 'Could not list applications.'}),
        );
      }
    },
    [read],
  );

  const getApplication = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const applicationId = typeof args.applicationId === 'string' ? args.applicationId.trim() : '';

      if (!applicationId) {
        return toolRefusal({code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND, message: 'applicationId is required.'});
      }

      try {
        const application = await read({kind: 'application', applicationId});

        return toolSuccess(toApplicationSummary(application));
      } catch (error) {
        return toolRefusal(
          asRefusal(error, {
            code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND,
            message: `Could not read application "${applicationId}".`,
          }),
        );
      }
    },
    [read],
  );

  const listLoginFlows = useCallback(async (): Promise<WebMcpToolResult> => {
    try {
      const response = await read({kind: 'loginFlows'});

      return toolSuccess({
        totalResults: response.totalResults,
        flows: (response.flows ?? []).map((flow) => ({
          id: flow.id,
          name: flow.name,
          handle: flow.handle,
          flowType: flow.flowType,
          isReadOnly: flow.isReadOnly === true,
        })),
      });
    } catch (error) {
      return toolRefusal(
        asRefusal(error, {code: WebMcpRefusalCodes.REQUEST_FAILED, message: 'Could not list login flows.'}),
      );
    }
  }, [read]);

  const getLoginFlow = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const flowId = typeof args.flowId === 'string' ? args.flowId.trim() : '';

      if (!flowId) {
        return toolRefusal({code: WebMcpRefusalCodes.FLOW_NOT_FOUND, message: 'flowId is required.'});
      }

      try {
        const flow = await read({kind: 'loginFlow', flowId});

        return toolSuccess({
          id: flow.id,
          name: flow.name,
          handle: flow.handle,
          flowType: flow.flowType,
          activeVersion: flow.activeVersion,
          stepCount: flow.nodes?.length ?? 0,
          isReadOnly: flow.isReadOnly === true,
        });
      } catch (error) {
        return toolRefusal(
          asRefusal(error, {code: WebMcpRefusalCodes.FLOW_NOT_FOUND, message: `Could not read flow "${flowId}".`}),
        );
      }
    },
    [read],
  );

  const createApplication = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const requestedTemplate = typeof args.template === 'string' ? args.template.trim().toUpperCase() : '';
      const templateOption = templateOptions.find((option) => option.value === requestedTemplate);

      if (!templateOption) {
        return toolRefusal({
          code: WebMcpRefusalCodes.TEMPLATE_NOT_ALLOWED,
          message:
            `"${String(args.template)}" is not a template this journey creates from. It only creates ` +
            'browser and full-stack applications whose template already defaults to authorization code with ' +
            'PKCE, so an insecure OAuth profile is not reachable through this tool.',
          details: {allowedTemplates: templateOptions.map((option) => option.value)},
        });
      }

      const name = typeof args.name === 'string' ? args.name.trim() : '';

      if (name.length < ApplicationConstants.NAME_MIN_LENGTH || name.length > ApplicationConstants.NAME_MAX_LENGTH) {
        return toolRefusal({
          code: WebMcpRefusalCodes.INVALID_NAME,
          message:
            `The application name must be between ${ApplicationConstants.NAME_MIN_LENGTH} and ` +
            `${ApplicationConstants.NAME_MAX_LENGTH} characters.`,
        });
      }

      const redirectUris = validateRedirectUris(args.redirectUris);

      if (!Array.isArray(redirectUris)) {
        return toolRefusal(redirectUris);
      }

      const organizationUnit = await resolveOrganizationUnit(
        typeof args.ouId === 'string' && args.ouId.trim() ? args.ouId.trim() : undefined,
      );

      if ('code' in organizationUnit) {
        return toolRefusal(organizationUnit);
      }

      const draft: GuidedApplicationDraft = {
        template: templateOption.value,
        templateId: templateOption.templateId,
        templateDisplayName: templateOption.displayName,
        name,
        redirectUris,
        ouId: organizationUnit.ouId,
        ouName: organizationUnit.ouName,
      };

      const pending = begin({kind: 'createApplication', draft});

      announce({label: t('common:webmcp.spotlight.openingWizard', 'Opening the application wizard')});

      try {
        // The template gallery is the console's own entry point into the wizard: it selects the
        // template, seeds the shared creation context and forwards to the create route. Going
        // through it is what makes the tool follow the same path as the home page's framework
        // picker, rather than assuming the wizard's URL structure.
        await navigate(`${RouteConfig.applications.types()}?type=${draft.template}`);

        if (!(await waitUntilPrefilled(UI_READY_TIMEOUT_MS))) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.UI_NOT_READY,
            message: 'The application creation wizard did not open, so nothing was created.',
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        // Point the pointer at the accept button (ringing it) while the dialog is up. Fire-and-forget:
        // the confirm request is set synchronously below, so the button exists by the time it looks.
        if (getWebMcpTimings().enabled) {
          void pointAtConfirmButton(getWebMcpTimings().cursorMoveMs);
        }
        const approved = await confirm({
          title: t('common:webmcp.createApplication.title', 'Create this application?'),
          description: t(
            'common:webmcp.createApplication.description',
            'The wizard behind this dialog is filled in with the values below. Confirm to create the application.',
          ),
          confirmLabel: t('common:webmcp.createApplication.confirmLabel', 'Create application'),
          details: [
            {label: t('common:webmcp.fields.name', 'Name'), value: draft.name},
            {label: t('common:webmcp.fields.template', 'Template'), value: draft.templateDisplayName},
            {
              label: t('common:webmcp.fields.organizationUnit', 'Organization unit'),
              value:
                draft.ouName ??
                t('common:webmcp.fields.organizationUnitDefault', "The deployment's only organization unit"),
            },
            {label: t('common:webmcp.fields.redirectUris', 'Redirect URIs'), value: draft.redirectUris.join('\n')},
            {
              label: t('common:webmcp.fields.grant', 'Grant'),
              value: t('common:webmcp.fields.grantValue', 'Authorization code with PKCE'),
            },
          ],
        });

        if (!approved) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.DECLINED,
            message: 'The admin declined, so no application was created.',
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        announce({label: t('common:webmcp.spotlight.creatingApplication', 'Creating the application')});
        await sleep(getWebMcpTimings().preClickMs);
        requestSubmit();

        const outcome = await pending;

        if (isRefusal(outcome)) {
          return toolRefusal(outcome);
        }

        return toolSuccess({
          ...outcome,
          template: draft.templateId,
          redirectUris: draft.redirectUris,
          message:
            'The application was created through the console wizard, which also generated its login flow. ' +
            "The console is now on the application's page.",
        });
      } catch (error) {
        const refusal = asRefusal(error, {
          code: WebMcpRefusalCodes.REQUEST_FAILED,
          message: 'The application was not created.',
        });
        settleFailure(refusal);

        return toolRefusal(refusal);
      }
    },
    [templateOptions, resolveOrganizationUnit, navigate, confirm, t],
  );

  const createLoginFlow = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const name = typeof args.name === 'string' ? args.name.trim() : '';

      if (name.length < 1 || name.length > 255) {
        return toolRefusal({
          code: WebMcpRefusalCodes.INVALID_NAME,
          message: 'The flow name must be between 1 and 255 characters.',
        });
      }

      const handle = generateFlowHandle(name);
      if (!handle) {
        return toolRefusal({
          code: WebMcpRefusalCodes.INVALID_NAME,
          message: 'The flow name must contain at least one letter or number.',
        });
      }

      const requestedTemplate = typeof args.template === 'string' ? args.template.trim().toUpperCase() : '';
      const template = authFlowTemplates.find((entry) => entry.type.toUpperCase() === requestedTemplate);

      if (!template) {
        return toolRefusal({
          code: WebMcpRefusalCodes.FLOW_TEMPLATE_NOT_ALLOWED,
          message: `"${String(args.template)}" is not an authentication flow template this journey creates from.`,
          details: {
            allowedTemplates: authFlowTemplates.map((entry) => ({type: entry.type, label: entry.display.label})),
          },
        });
      }

      const draft = {
        name,
        handle,
        templateType: template.type,
        templateLabel: template.display.label,
        flowType: FlowType.AUTHENTICATION,
      };

      const pending = begin({kind: 'createLoginFlow', draft});

      announce({label: t('common:webmcp.spotlight.openingFlowWizard', 'Opening the login flow wizard')});

      try {
        await navigate(RouteConfig.flows.create());

        if (!(await waitUntilPrefilled(UI_READY_TIMEOUT_MS))) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.UI_NOT_READY,
            message: 'The flow creation wizard did not open, so nothing was created.',
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        // Point the pointer at the accept button (ringing it) while the dialog is up. Fire-and-forget:
        // the confirm request is set synchronously below, so the button exists by the time it looks.
        if (getWebMcpTimings().enabled) {
          void pointAtConfirmButton(getWebMcpTimings().cursorMoveMs);
        }
        const approved = await confirm({
          title: t('common:webmcp.createLoginFlow.title', 'Create this login flow?'),
          description: t(
            'common:webmcp.createLoginFlow.description',
            'The flow wizard behind this dialog is filled in with the values below. Confirm to create the login flow.',
          ),
          confirmLabel: t('common:webmcp.createLoginFlow.confirmLabel', 'Create login flow'),
          details: [
            {label: t('common:webmcp.fields.name', 'Name'), value: draft.name},
            {label: t('common:webmcp.fields.template', 'Template'), value: draft.templateLabel},
          ],
        });

        if (!approved) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.DECLINED,
            message: 'The admin declined, so no login flow was created.',
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        announce({label: t('common:webmcp.spotlight.creatingLoginFlow', 'Creating the login flow')});
        await sleep(getWebMcpTimings().preClickMs);
        requestSubmit();

        const outcome = await pending;

        if (isRefusal(outcome)) {
          return toolRefusal(outcome);
        }

        if (!('flowId' in outcome)) {
          return toolRefusal({code: WebMcpRefusalCodes.REQUEST_FAILED, message: 'The login flow was not created.'});
        }

        return toolSuccess({
          flowId: outcome.flowId,
          name: draft.name,
          template: draft.templateType,
          flowType: draft.flowType,
          message:
            `The login flow "${draft.name}" was created through the console wizard, which is now open on the flow ` +
            `builder. Attach it to an application with ${WebMcpTools.CONFIGURE_LOGIN_FLOW}.`,
        });
      } catch (error) {
        const refusal = asRefusal(error, {
          code: WebMcpRefusalCodes.REQUEST_FAILED,
          message: 'The login flow was not created.',
        });
        settleFailure(refusal);

        return toolRefusal(refusal);
      }
    },
    [authFlowTemplates, navigate, confirm, t],
  );

  const configureLoginFlow = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const applicationId = typeof args.applicationId === 'string' ? args.applicationId.trim() : '';
      const flowId = typeof args.flowId === 'string' ? args.flowId.trim() : '';

      if (!applicationId || !flowId) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND,
          message: 'Both applicationId and flowId are required.',
        });
      }

      let application: Application;
      try {
        application = await read({kind: 'application', applicationId});
      } catch {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND,
          message: `No application with id "${applicationId}" could be read.`,
        });
      }

      if (application.isReadOnly === true) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_READ_ONLY,
          message: `Application "${application.name}" is declarative and read-only, so its login flow cannot be changed from the console.`,
        });
      }

      const oauth2 = getOAuth2Config(application);

      if (!hasUserAccess(oauth2?.grantTypes)) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NOT_USER_FACING,
          message:
            `Application "${application.name}" has no grant that signs an end user in, so a login flow has ` +
            'nothing to run. Its grant types are: ' +
            `${(oauth2?.grantTypes ?? []).join(', ') || 'none'}.`,
        });
      }

      const usableRedirectUris = (oauth2?.redirectUris ?? []).filter((uri) => uri.trim() && !uri.includes('*'));

      if (usableRedirectUris.length === 0) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NO_REDIRECT_URI,
          message:
            `Application "${application.name}" has no confirmed, non-wildcard redirect URI yet, so a login ` +
            'flow attached to it could not complete a sign-in. Add one on its Access settings first.',
        });
      }

      let flowName = flowId;
      try {
        const flow = await read({kind: 'loginFlow', flowId});
        flowName = flow.name;

        if (flow.flowType !== FlowType.AUTHENTICATION) {
          return toolRefusal({
            code: WebMcpRefusalCodes.FLOW_WRONG_TYPE,
            message: `Flow "${flow.name}" is a ${String(flow.flowType)} flow, not an authentication flow.`,
          });
        }
      } catch {
        return toolRefusal({
          code: WebMcpRefusalCodes.FLOW_NOT_FOUND,
          message: `No flow with id "${flowId}" could be read.`,
        });
      }

      const pending = begin({
        kind: 'configureLoginFlow',
        draft: {
          applicationId,
          applicationName: application.name,
          flowId,
          flowName,
          currentFlowId: application.authFlowId,
        },
      });

      announce({
        label: t('common:webmcp.spotlight.openingFlows', "Opening the application's login flow settings"),
      });

      try {
        await navigate(RouteConfig.applications.detail(applicationId));

        if (!(await waitUntilPrefilled(UI_READY_TIMEOUT_MS))) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.UI_NOT_READY,
            message: "The application's settings page did not open, so nothing was changed.",
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        // Point the pointer at the accept button (ringing it) while the dialog is up. Fire-and-forget:
        // the confirm request is set synchronously below, so the button exists by the time it looks.
        if (getWebMcpTimings().enabled) {
          void pointAtConfirmButton(getWebMcpTimings().cursorMoveMs);
        }
        const approved = await confirm({
          title: t('common:webmcp.configureLoginFlow.title', "Change this application's login flow?"),
          description: t(
            'common:webmcp.configureLoginFlow.description',
            'The change below is staged on the Flows tab behind this dialog. Confirm to save it.',
          ),
          confirmLabel: t('common:webmcp.configureLoginFlow.confirmLabel', 'Save login flow'),
          details: [
            {label: t('common:webmcp.fields.application', 'Application'), value: application.name},
            {label: t('common:webmcp.fields.newLoginFlow', 'New login flow'), value: flowName},
            {
              label: t('common:webmcp.fields.currentLoginFlow', 'Current login flow'),
              value: application.authFlowId ?? t('common:webmcp.fields.none', 'None'),
            },
          ],
        });

        if (!approved) {
          const refusal: WebMcpRefusal = {
            code: WebMcpRefusalCodes.DECLINED,
            message: 'The admin declined, so the login flow was not changed.',
          };
          settleFailure(refusal);

          return toolRefusal(refusal);
        }

        announce({label: t('common:webmcp.spotlight.savingLoginFlow', 'Saving the login flow')});
        requestSubmit();

        const outcome = await pending;

        if (isRefusal(outcome)) {
          return toolRefusal(outcome);
        }

        return toolSuccess({
          ...outcome,
          message: `"${application.name}" now signs users in through "${flowName}".`,
        });
      } catch (error) {
        const refusal = asRefusal(error, {
          code: WebMcpRefusalCodes.REQUEST_FAILED,
          message: 'The login flow was not changed.',
        });
        settleFailure(refusal);

        return toolRefusal(refusal);
      }
    },
    [read, navigate, confirm, t],
  );

  const runTestLogin = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const applicationId = typeof args.applicationId === 'string' ? args.applicationId.trim() : '';

      if (!applicationId) {
        return toolRefusal({code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND, message: 'applicationId is required.'});
      }

      let application: Application;
      try {
        application = await read({kind: 'application', applicationId});
      } catch {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NOT_FOUND,
          message: `No application with id "${applicationId}" could be read.`,
        });
      }

      const oauth2 = getOAuth2Config(application);

      if (!oauth2?.clientId) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NO_CLIENT_ID,
          message: `Application "${application.name}" has no OAuth2 client identifier, so it cannot start a login.`,
        });
      }

      if (!hasUserAccess(oauth2.grantTypes)) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NOT_USER_FACING,
          message: `Application "${application.name}" has no grant that signs an end user in, so there is no login to test.`,
        });
      }

      if (!application.authFlowId) {
        return toolRefusal({
          code: WebMcpRefusalCodes.FLOW_NOT_FOUND,
          message: `Application "${application.name}" has no login flow configured yet. Configure one first.`,
        });
      }

      const redirectUri = (oauth2.redirectUris ?? []).find((uri) => uri.trim() && !uri.includes('*'));

      if (!redirectUri) {
        return toolRefusal({
          code: WebMcpRefusalCodes.APPLICATION_NO_REDIRECT_URI,
          message: `Application "${application.name}" has no confirmed, non-wildcard redirect URI to send the authorization code to.`,
        });
      }

      const request = await buildTestLoginUrl({serverUrl: getServerUrl(), clientId: oauth2.clientId, redirectUri});

      if (getWebMcpTimings().enabled) {
        void pointAtConfirmButton(getWebMcpTimings().cursorMoveMs);
      }
      const approved = await confirm({
        title: t('common:webmcp.testLogin.title', 'Start a test sign-in?'),
        description: t(
          'common:webmcp.testLogin.description',
          'This opens a new tab at the sign-in screen for this application. The authorization code is sent to ' +
            'its redirect URI, so that URL has to be running to complete the exchange.',
        ),
        confirmLabel: t('common:webmcp.testLogin.confirmLabel', 'Open sign-in'),
        details: [
          {label: t('common:webmcp.fields.application', 'Application'), value: application.name},
          {label: t('common:webmcp.fields.redirectUri', 'Redirect URI'), value: redirectUri},
          {label: t('common:webmcp.fields.authorizationUrl', 'Authorization URL'), value: request.url},
        ],
      });

      if (!approved) {
        return toolRefusal({
          code: WebMcpRefusalCodes.DECLINED,
          message: 'The admin declined, so no test sign-in was started.',
        });
      }

      announce({label: t('common:webmcp.spotlight.startingTestLogin', 'Starting a test sign-in')});
      await sleep(getWebMcpTimings().preClickMs);
      window.open(request.url, '_blank', 'noopener,noreferrer');

      return toolSuccess({
        applicationId,
        authorizationUrl: request.url,
        redirectUri,
        state: request.state,
        codeVerifier: request.codeVerifier,
        message:
          'A new tab is open at the sign-in screen. After signing in, the authorization code arrives at the ' +
          'redirect URI with the state above; exchange it using the PKCE code verifier above.',
      });
    },
    [read, getServerUrl, confirm, t],
  );

  return useMemo<WebMcpToolDescriptor[]>(
    () => [
      {
        name: WebMcpTools.LIST_ORGANIZATION_UNITS,
        description:
          'List the organization units an application can be created in. `requiresExplicitChoice` is true when ' +
          'the deployment has more than one, in which case creating an application requires naming one.',
        inputSchema: {type: 'object', properties: {}, additionalProperties: false},
        annotations: {title: 'List Organization Units', readOnlyHint: true},
        execute: listOrganizationUnits,
      },
      {
        name: WebMcpTools.SEARCH_APPLICATIONS,
        description:
          'List the applications in this deployment, optionally filtered by a substring of the name. Use this to ' +
          'check whether the application the admin is describing already exists before creating one.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {type: 'string', description: 'Case-insensitive substring of the application name.'},
            limit: {type: 'integer', minimum: 1, maximum: 100, default: 30},
          },
          additionalProperties: false,
        },
        annotations: {title: 'Search Applications', readOnlyHint: true},
        execute: searchApplications,
      },
      {
        name: WebMcpTools.GET_APPLICATION,
        description:
          'Read one application, including its OAuth2 profile (redirect URIs, grant types, PKCE, public client) ' +
          'and its configured login flow. The client secret is never returned.',
        inputSchema: {
          type: 'object',
          properties: {applicationId: {type: 'string'}},
          required: ['applicationId'],
          additionalProperties: false,
        },
        annotations: {title: 'Get Application', readOnlyHint: true},
        execute: getApplication,
      },
      {
        name: WebMcpTools.LIST_LOGIN_FLOWS,
        description: 'List the authentication flows available to attach to an application as its login flow.',
        inputSchema: {type: 'object', properties: {}, additionalProperties: false},
        annotations: {title: 'List Login Flows', readOnlyHint: true},
        execute: listLoginFlows,
      },
      {
        name: WebMcpTools.GET_LOGIN_FLOW,
        description: 'Read one login flow: its name, type, active version and number of steps.',
        inputSchema: {
          type: 'object',
          properties: {flowId: {type: 'string'}},
          required: ['flowId'],
          additionalProperties: false,
        },
        annotations: {title: 'Get Login Flow', readOnlyHint: true},
        execute: getLoginFlow,
      },
      {
        name: WebMcpTools.CREATE_APPLICATION,
        description:
          "Create an OAuth2/OIDC application by driving the console's own creation wizard: it navigates there, " +
          'fills the form in, and waits for the admin to confirm before submitting. The OAuth profile is not an ' +
          'input; it comes from the chosen template, all of which default to authorization code with PKCE. ' +
          'Wildcard redirect URIs, non-loopback http URIs, and templates without PKCE are refused. Creating the ' +
          'application also generates its login flow, as it does for a human using the wizard.',
        inputSchema: {
          type: 'object',
          properties: {
            template: {
              type: 'string',
              enum: templateOptions.map((option) => option.value),
              description: 'Which kind of application to create.',
            },
            name: {
              type: 'string',
              minLength: ApplicationConstants.NAME_MIN_LENGTH,
              maxLength: ApplicationConstants.NAME_MAX_LENGTH,
            },
            redirectUris: {
              type: 'array',
              items: {type: 'string'},
              minItems: 1,
              description: 'Exact callback URLs. Wildcards are refused. http is accepted only for localhost.',
            },
            ouId: {
              type: 'string',
              description:
                'Organization unit id or handle. Required when the deployment has more than one; call ' +
                `${WebMcpTools.LIST_ORGANIZATION_UNITS} first to find out.`,
            },
          },
          required: ['template', 'name', 'redirectUris'],
          additionalProperties: false,
        },
        annotations: {title: 'Create Application', readOnlyHint: false},
        execute: createApplication,
      },
      {
        name: WebMcpTools.CREATE_LOGIN_FLOW,
        description:
          "Create an authentication (login) flow from a built-in template by driving the console's flow-creation " +
          'wizard: it navigates there, selects the template and fills the name in, and waits for the admin to ' +
          'confirm before creating. Returns the new flow id, which ' +
          `${WebMcpTools.CONFIGURE_LOGIN_FLOW} can then attach to an application. Templates: ` +
          `${authFlowTemplates.map((entry) => `${entry.type} (${entry.display.label})`).join(', ')}.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {type: 'string', minLength: 1, maxLength: 255},
            template: {
              type: 'string',
              enum: authFlowTemplateTypes,
              description: 'Which authentication template to create the flow from.',
            },
          },
          required: ['name', 'template'],
          additionalProperties: false,
        },
        annotations: {title: 'Create Login Flow', readOnlyHint: false},
        execute: createLoginFlow,
      },
      {
        name: WebMcpTools.CONFIGURE_LOGIN_FLOW,
        description:
          'Attach an existing authentication flow to an existing application as its login flow, by opening the ' +
          "application's Flows tab, staging the change there, and waiting for the admin to confirm before saving. " +
          'Refuses when the application is read-only, has no grant that signs an end user in, or has no confirmed ' +
          'non-wildcard redirect URI, and when the flow is not an authentication flow.',
        inputSchema: {
          type: 'object',
          properties: {applicationId: {type: 'string'}, flowId: {type: 'string'}},
          required: ['applicationId', 'flowId'],
          additionalProperties: false,
        },
        annotations: {title: 'Configure Login Flow', readOnlyHint: false},
        execute: configureLoginFlow,
      },
      {
        name: WebMcpTools.RUN_TEST_LOGIN,
        description:
          'Start a real sign-in against an application, to check the configuration end to end. Builds an ' +
          "authorization code request with PKCE against the deployment's authorization endpoint and, after the " +
          'admin confirms, opens it in a new tab. Returns the state and PKCE verifier needed to complete the code ' +
          "exchange. The application's redirect URI has to be running to receive the code.",
        inputSchema: {
          type: 'object',
          properties: {applicationId: {type: 'string'}},
          required: ['applicationId'],
          additionalProperties: false,
        },
        annotations: {title: 'Run Test Login', readOnlyHint: false},
        execute: runTestLogin,
      },
    ],
    [
      templateOptions,
      authFlowTemplates,
      authFlowTemplateTypes,
      listOrganizationUnits,
      searchApplications,
      getApplication,
      listLoginFlows,
      getLoginFlow,
      createApplication,
      createLoginFlow,
      configureLoginFlow,
      runTestLogin,
    ],
  );
}
