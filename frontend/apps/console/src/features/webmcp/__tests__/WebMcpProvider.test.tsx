// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, render} from '@thunderid/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';
import WebMcpTools from '../constants/webmcp-tools';
import type {WebMcpToolDescriptor} from '../models/webmcp';
import WebMcpProvider from '../WebMcpProvider';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {...actual, useNavigate: () => mockNavigate};
});

function installModelContext(): {
  registerTool: ReturnType<typeof vi.fn>;
  unregisterTool: ReturnType<typeof vi.fn>;
  registered: WebMcpToolDescriptor[];
} {
  const registered: WebMcpToolDescriptor[] = [];
  const registerTool = vi.fn((tool: WebMcpToolDescriptor) => {
    registered.push(tool);
    return undefined;
  });
  const unregisterTool = vi.fn();

  Object.defineProperty(document, 'modelContext', {
    value: {registerTool, unregisterTool},
    configurable: true,
    writable: true,
  });

  return {registerTool, unregisterTool, registered};
}

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext');
  Reflect.deleteProperty(navigator, 'modelContext');
});

describe('WebMcpProvider', () => {
  it('registers nothing when WebMCP is unavailable', () => {
    // The console must behave identically in a browser without WebMCP, so an absent modelContext is
    // not an error path - it simply means no tools exist.
    expect(() => render(<WebMcpProvider />)).not.toThrow();
  });

  it('registers the SSO journey tools once', () => {
    const {registerTool, registered} = installModelContext();

    render(<WebMcpProvider />);

    expect(registerTool).toHaveBeenCalledTimes(Object.keys(WebMcpTools).length);
    expect(registered.map((tool) => tool.name)).toEqual(expect.arrayContaining(Object.values(WebMcpTools)));
  });

  it('marks every read tool read-only and every write tool not', () => {
    const {registered} = installModelContext();

    render(<WebMcpProvider />);

    const readOnlyNames = registered
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name)
      .sort();

    expect(readOnlyNames).toEqual(
      [
        WebMcpTools.LIST_SECTIONS,
        WebMcpTools.GET_APPLICATION,
        WebMcpTools.GET_LOGIN_FLOW,
        WebMcpTools.LIST_LOGIN_FLOWS,
        WebMcpTools.LIST_ORGANIZATION_UNITS,
        WebMcpTools.SEARCH_APPLICATIONS,
      ].sort(),
    );

    for (const name of [
      WebMcpTools.NAVIGATE,
      WebMcpTools.CREATE_APPLICATION,
      WebMcpTools.CREATE_LOGIN_FLOW,
      WebMcpTools.CONFIGURE_LOGIN_FLOW,
      WebMcpTools.RUN_TEST_LOGIN,
    ]) {
      expect(registered.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(false);
    }
  });

  it('gives every tool a title, a description and an input schema', () => {
    const {registered} = installModelContext();

    render(<WebMcpProvider />);

    for (const tool of registered) {
      expect(tool.annotations?.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({type: 'object'});
    }
  });

  it('unregisters every tool on unmount', () => {
    const {unregisterTool} = installModelContext();

    const {unmount} = render(<WebMcpProvider />);
    unmount();

    expect(unregisterTool.mock.calls.map((call) => call[0] as string)).toEqual(
      expect.arrayContaining(Object.values(WebMcpTools)),
    );
  });

  it('publishes every tool through provideContext when registerTool is absent', () => {
    const provideContext = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: {provideContext},
      configurable: true,
      writable: true,
    });

    const {unmount} = render(<WebMcpProvider />);

    expect(provideContext).toHaveBeenCalledTimes(1);
    const published = (provideContext.mock.calls[0][0] as {tools: WebMcpToolDescriptor[]}).tools;
    expect(published.map((tool) => tool.name)).toEqual(expect.arrayContaining(Object.values(WebMcpTools)));

    unmount();
    // Teardown publishes an empty set, the bulk-API equivalent of unregistering every tool.
    expect(provideContext).toHaveBeenLastCalledWith({tools: []});
  });

  it('registers once a bridge injects modelContext after mount', () => {
    vi.useFakeTimers();
    try {
      const registerTool = vi.fn();
      render(<WebMcpProvider />);

      // No WebMCP at mount: an extension bridge has not attached yet.
      expect(registerTool).not.toHaveBeenCalled();

      Object.defineProperty(document, 'modelContext', {
        value: {registerTool},
        configurable: true,
        writable: true,
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Self-healing retries may re-publish, so assert on the distinct tool names rather than an
      // exact call count.
      const registeredNames = new Set(
        registerTool.mock.calls.map((call) => (call[0] as WebMcpToolDescriptor).name),
      );
      for (const name of Object.values(WebMcpTools)) {
        expect(registeredNames).toContain(name);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a single tool rather than the provider when registration throws', () => {
    const registered: string[] = [];
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (tool: WebMcpToolDescriptor) => {
          if (tool.name === WebMcpTools.CREATE_APPLICATION) {
            throw new Error('unsupported');
          }
          registered.push(tool.name);
          return undefined;
        },
      },
      configurable: true,
      writable: true,
    });

    expect(() => render(<WebMcpProvider />)).not.toThrow();
    expect(registered).toContain(WebMcpTools.SEARCH_APPLICATIONS);
    expect(registered).not.toContain(WebMcpTools.CREATE_APPLICATION);
  });
});
