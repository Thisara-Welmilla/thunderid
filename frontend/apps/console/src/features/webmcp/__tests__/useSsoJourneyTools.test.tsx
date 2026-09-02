// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {Application} from '@thunderid/configure-applications';
import {renderHook, waitFor} from '@thunderid/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import WebMcpTools from '../constants/webmcp-tools';
import useSsoJourneyTools from '../hooks/useSsoJourneyTools';
import type {ToolReads} from '../hooks/useToolReads';
import type {WebMcpConfirmation} from '../hooks/useWebMcpConfirmation';
import {WebMcpRefusalCodes} from '../models/journey';
import type {ToolReadRequest} from '../models/tool-reads';
import type {WebMcpToolDescriptor, WebMcpToolResult} from '../models/webmcp';
import {GuidedPhases, getSnapshot, markPrefilled, settleFailure, settleSuccess} from '../store/guidedJourneyStore';

const mockNavigate = vi.fn(() => Promise.resolve());

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {...actual, useNavigate: () => mockNavigate};
});

vi.mock('@thunderid/contexts', async () => {
  const actual = await vi.importActual<typeof import('@thunderid/contexts')>('@thunderid/contexts');
  return {...actual, useConfig: () => ({getServerUrl: () => 'https://localhost:8090'})};
});

const browserApplication: Application = {
  id: 'app-1',
  name: 'Storefront',
  type: 'browser',
  template: 'react',
  authFlowId: 'flow-1',
  inboundAuthConfig: [
    {
      type: 'oauth2',
      config: {
        clientId: 'client-1',
        clientSecret: 'super-secret',
        redirectUris: ['https://app.example.com/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        pkceRequired: true,
        publicClient: true,
        tokenEndpointAuthMethod: 'none',
      },
    },
  ],
} as unknown as Application;

let readHandler: (request: ToolReadRequest) => Promise<unknown>;
let confirmResult: boolean;
const confirmSpy = vi.fn();

function renderTools(): {tool: (name: string) => WebMcpToolDescriptor} {
  const reads: ToolReads = {
    pending: [],
    read: ((request: ToolReadRequest) => readHandler(request)) as ToolReads['read'],
    settle: vi.fn(),
  };
  const confirmation: WebMcpConfirmation = {
    request: null,
    confirm: (request) => {
      confirmSpy(request);
      return Promise.resolve(confirmResult);
    },
    settle: vi.fn(),
  };

  const {result} = renderHook(() => useSsoJourneyTools({reads, confirmation}));

  return {
    tool: (name: string) => {
      const found = result.current.find((entry) => entry.name === name);
      if (!found) {
        throw new Error(`Tool ${name} was not registered`);
      }
      return found;
    },
  };
}

function parse(result: WebMcpToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  confirmResult = false;
  readHandler = () => Promise.reject(new Error('unexpected read'));
  mockNavigate.mockClear();
  confirmSpy.mockClear();
});

afterEach(() => {
  if (getSnapshot().phase !== GuidedPhases.IDLE) {
    settleFailure({code: WebMcpRefusalCodes.DECLINED, message: 'test cleanup'});
  }
});

describe('read tools', () => {
  it('never returns the client secret', async () => {
    readHandler = () => Promise.resolve(browserApplication);
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.GET_APPLICATION).execute({applicationId: 'app-1'});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('super-secret');
    expect(parse(result).oauth2).toMatchObject({clientId: 'client-1', pkceRequired: true});
  });

  it('filters applications by name, since the list endpoint has no search parameter', async () => {
    readHandler = () =>
      Promise.resolve({
        totalResults: 2,
        startIndex: 0,
        count: 2,
        applications: [
          {id: 'app-1', name: 'Storefront'},
          {id: 'app-2', name: 'Admin Portal'},
        ],
      });
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.SEARCH_APPLICATIONS).execute({query: 'store'});

    expect(parse(result).matched).toBe(1);
  });

  it('refuses get_application without an id', async () => {
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.GET_APPLICATION).execute({});

    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe(WebMcpRefusalCodes.APPLICATION_NOT_FOUND);
  });

  it('flags an ambiguous organization unit choice on the listing', async () => {
    readHandler = () =>
      Promise.resolve({
        hasMultipleOUs: true,
        organizationUnits: [
          {id: 'ou-1', handle: 'root', name: 'Root'},
          {id: 'ou-2', handle: 'eng', name: 'Engineering'},
        ],
      });
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.LIST_ORGANIZATION_UNITS).execute({});

    expect(parse(result).requiresExplicitChoice).toBe(true);
  });
});

describe('create_application validation', () => {
  it('refuses a template outside the secure allow-list', async () => {
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'BACKEND',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe(WebMcpRefusalCodes.TEMPLATE_NOT_ALLOWED);
  });

  it('refuses a wildcard redirect URI', async () => {
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://*.example.com/callback'],
    });

    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe(WebMcpRefusalCodes.REDIRECT_URI_WILDCARD);
  });

  it('refuses an empty name', async () => {
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: '   ',
      redirectUris: ['https://app.example.com/callback'],
    });

    expect(parse(result).code).toBe(WebMcpRefusalCodes.INVALID_NAME);
  });

  it('refuses to guess the organization unit, and hands back the choices', async () => {
    readHandler = () =>
      Promise.resolve({
        hasMultipleOUs: true,
        organizationUnits: [
          {id: 'ou-1', handle: 'root', name: 'Root'},
          {id: 'ou-2', handle: 'eng', name: 'Engineering'},
        ],
      });
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    expect(parse(result).code).toBe(WebMcpRefusalCodes.ORGANIZATION_UNIT_AMBIGUOUS);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not offer grant type, PKCE or client type as inputs', () => {
    const {tool} = renderTools();
    const schema = tool(WebMcpTools.CREATE_APPLICATION).inputSchema as {properties: Record<string, unknown>};

    expect(Object.keys(schema.properties).sort()).toEqual(['name', 'ouId', 'redirectUris', 'template']);
  });
});

describe('create_application journey', () => {
  beforeEach(() => {
    readHandler = () => Promise.resolve({hasMultipleOUs: false, organizationUnits: [{id: 'ou-1', name: 'Root'}]});
  });

  it('enters the wizard through the console template gallery deep link', async () => {
    const {tool} = renderTools();

    const pending = tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/applications/types?type=REACT');
    });

    markPrefilled();
    await pending;
  });

  it('creates nothing when the admin declines', async () => {
    const {tool} = renderTools();

    const pending = tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    markPrefilled();

    const result = await pending;

    expect(confirmSpy).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe(WebMcpRefusalCodes.DECLINED);
    // The wizard is never released to submit, so no application is created.
    expect(getSnapshot().phase).toBe(GuidedPhases.IDLE);
  });

  it('shows the admin exactly what is about to be created', async () => {
    const {tool} = renderTools();

    const pending = tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    markPrefilled();
    await pending;

    const values = (confirmSpy.mock.calls[0][0] as {details: {value: string}[]}).details.map((detail) => detail.value);

    expect(values).toContain('Storefront');
    expect(values).toContain('https://app.example.com/callback');
    expect(values).toContain('Authorization code with PKCE');
  });

  it('returns the created application once the wizard reports success', async () => {
    confirmResult = true;
    const {tool} = renderTools();

    const pending = tool(WebMcpTools.CREATE_APPLICATION).execute({
      template: 'REACT',
      name: 'Storefront',
      redirectUris: ['https://app.example.com/callback'],
    });

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.PREFILLING);
    });
    markPrefilled();

    await waitFor(() => {
      expect(getSnapshot().phase).toBe(GuidedPhases.SUBMITTING);
    });
    settleSuccess({applicationId: 'app-1', clientId: 'client-1', authFlowId: 'flow-1'});

    const result = await pending;

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({applicationId: 'app-1', clientId: 'client-1', template: 'react'});
  });
});

describe('configure_login_flow preconditions', () => {
  it('refuses a read-only application', async () => {
    readHandler = () => Promise.resolve({...browserApplication, isReadOnly: true});
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CONFIGURE_LOGIN_FLOW).execute({applicationId: 'app-1', flowId: 'flow-2'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.APPLICATION_READ_ONLY);
  });

  it('refuses an application with no grant that signs a user in', async () => {
    readHandler = () =>
      Promise.resolve({
        ...browserApplication,
        inboundAuthConfig: [{type: 'oauth2', config: {grantTypes: ['client_credentials'], redirectUris: []}}],
      });
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CONFIGURE_LOGIN_FLOW).execute({applicationId: 'app-1', flowId: 'flow-2'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.APPLICATION_NOT_USER_FACING);
  });

  it('refuses an application with no confirmed redirect URI', async () => {
    readHandler = () =>
      Promise.resolve({
        ...browserApplication,
        inboundAuthConfig: [
          {type: 'oauth2', config: {grantTypes: ['authorization_code'], redirectUris: ['https://*.example.com/cb']}},
        ],
      });
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CONFIGURE_LOGIN_FLOW).execute({applicationId: 'app-1', flowId: 'flow-2'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.APPLICATION_NO_REDIRECT_URI);
    expect(parse(result).message).toContain('no confirmed, non-wildcard redirect URI');
  });

  it('refuses a flow that is not an authentication flow', async () => {
    readHandler = (request) =>
      request.kind === 'application'
        ? Promise.resolve(browserApplication)
        : Promise.resolve({id: 'flow-2', name: 'Sign up', flowType: 'REGISTRATION', nodes: []});
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CONFIGURE_LOGIN_FLOW).execute({applicationId: 'app-1', flowId: 'flow-2'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.FLOW_WRONG_TYPE);
  });

  it('refuses a missing flow', async () => {
    readHandler = (request) =>
      request.kind === 'application' ? Promise.resolve(browserApplication) : Promise.reject(new Error('404'));
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.CONFIGURE_LOGIN_FLOW).execute({applicationId: 'app-1', flowId: 'nope'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.FLOW_NOT_FOUND);
  });
});

describe('run_test_login', () => {
  it('refuses an application with no login flow configured', async () => {
    readHandler = () => Promise.resolve({...browserApplication, authFlowId: undefined});
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.RUN_TEST_LOGIN).execute({applicationId: 'app-1'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.FLOW_NOT_FOUND);
  });

  it('opens nothing when the admin declines', async () => {
    readHandler = () => Promise.resolve(browserApplication);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.RUN_TEST_LOGIN).execute({applicationId: 'app-1'});

    expect(parse(result).code).toBe(WebMcpRefusalCodes.DECLINED);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the authorization URL once confirmed', async () => {
    confirmResult = true;
    readHandler = () => Promise.resolve(browserApplication);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const {tool} = renderTools();

    const result = await tool(WebMcpTools.RUN_TEST_LOGIN).execute({applicationId: 'app-1'});

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://localhost:8090/oauth2/authorize?'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(parse(result).codeVerifier).toBeTruthy();
  });
});
