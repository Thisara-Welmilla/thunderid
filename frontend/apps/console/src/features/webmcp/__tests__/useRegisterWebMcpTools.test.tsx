// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, renderHook} from '@thunderid/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';
import useRegisterWebMcpTools from '../hooks/useRegisterWebMcpTools';
import type {WebMcpToolDescriptor} from '../models/webmcp';
import {clearActivity, getSnapshot as getActivity} from '../store/webMcpActivityStore';

const tools: WebMcpToolDescriptor[] = [
  {
    name: 'thunderid_console_navigate',
    description: 'navigate',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => Promise.resolve({content: [{type: 'text', text: 'ok'}]}),
  },
  {
    name: 'thunderid_console_list_sections',
    description: 'list',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => Promise.resolve({content: [{type: 'text', text: 'ok'}]}),
  },
];

const toolNames = tools.map((tool) => tool.name);

function registeredNames(spy: ReturnType<typeof vi.fn>): Set<string> {
  return new Set(spy.mock.calls.map((call) => (call[0] as WebMcpToolDescriptor).name));
}

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext');
  Reflect.deleteProperty(navigator, 'modelContext');
  clearActivity();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRegisterWebMcpTools', () => {
  it('registers every tool on mount via registerTool', () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {value: {registerTool}, configurable: true, writable: true});

    renderHook(() => useRegisterWebMcpTools(tools));

    for (const name of toolNames) {
      expect(registeredNames(registerTool)).toContain(name);
    }
  });

  it('calls native methods bound to the model context (no Illegal invocation)', () => {
    const registered: string[] = [];
    // Emulate Chrome's built-in ModelContext: a host object whose methods throw when called detached
    // from it, which is what "Illegal invocation" is.
    const native = {
      registerTool(tool: WebMcpToolDescriptor): void {
        if (this !== native) {
          throw new TypeError("Failed to execute 'registerTool' on 'ModelContext': Illegal invocation");
        }
        registered.push(tool.name);
      },
    };
    Object.defineProperty(document, 'modelContext', {value: native, configurable: true, writable: true});

    renderHook(() => useRegisterWebMcpTools(tools));

    for (const name of toolNames) {
      expect(registered).toContain(name);
    }
  });

  it('falls back to provideContext when registerTool is absent', () => {
    const provideContext = vi.fn();
    Object.defineProperty(document, 'modelContext', {value: {provideContext}, configurable: true, writable: true});

    renderHook(() => useRegisterWebMcpTools(tools));

    const published = (provideContext.mock.calls[0][0] as {tools: WebMcpToolDescriptor[]}).tools;
    expect(published.map((tool) => tool.name)).toEqual(toolNames);
  });

  it('does nothing when WebMCP is absent', () => {
    expect(() => renderHook(() => useRegisterWebMcpTools(tools))).not.toThrow();
  });

  it('does not re-register the same context on focus, avoiding duplicate tool names', () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {value: {registerTool}, configurable: true, writable: true});

    renderHook(() => useRegisterWebMcpTools(tools));
    const afterMount = registerTool.mock.calls.length;
    expect(afterMount).toBe(tools.length);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // Same context: re-registering here is what throws "Duplicate tool name" natively, so it is skipped.
    expect(registerTool.mock.calls.length).toBe(afterMount);
  });

  it('registers a late-attaching context found by polling', () => {
    vi.useFakeTimers();
    const registerTool = vi.fn();

    renderHook(() => useRegisterWebMcpTools(tools));
    expect(registerTool).not.toHaveBeenCalled();

    Object.defineProperty(document, 'modelContext', {value: {registerTool}, configurable: true, writable: true});

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    for (const name of toolNames) {
      expect(registeredNames(registerTool)).toContain(name);
    }
  });

  it('re-registers with a replacement context and tears the old one down', () => {
    vi.useFakeTimers();
    const registerTool1 = vi.fn();
    const unregisterTool1 = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: {registerTool: registerTool1, unregisterTool: unregisterTool1},
      configurable: true,
      writable: true,
    });

    renderHook(() => useRegisterWebMcpTools(tools));
    expect(registeredNames(registerTool1)).toEqual(new Set(toolNames));

    const registerTool2 = vi.fn();
    Object.defineProperty(document, 'modelContext', {value: {registerTool: registerTool2}, configurable: true, writable: true});

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(registeredNames(registerTool2)).toEqual(new Set(toolNames));
    const unregisteredFromOld = new Set(unregisterTool1.mock.calls.map((call) => call[0] as string));
    for (const name of toolNames) {
      expect(unregisteredFromOld).toContain(name);
    }
  });

  it('shows the thinking indicator after a tool finishes when pacing is on', async () => {
    const store = new Map<string, string>([['webmcpSpeed', 'slow']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });

    const registerTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {value: {registerTool}, configurable: true, writable: true});

    renderHook(() => useRegisterWebMcpTools(tools));

    // The wrapped descriptor the tool was registered with, not the raw one.
    const registered = registerTool.mock.calls[0][0] as WebMcpToolDescriptor;
    await registered.execute({});

    expect(getActivity()).toMatchObject({thinking: true});
  });

  it('unregisters every tool on unmount', () => {
    const unregisterTool = vi.fn();
    Object.defineProperty(document, 'modelContext', {
      value: {registerTool: vi.fn(), unregisterTool},
      configurable: true,
      writable: true,
    });

    const {unmount} = renderHook(() => useRegisterWebMcpTools(tools));
    unmount();

    const unregistered = new Set(unregisterTool.mock.calls.map((call) => call[0] as string));
    for (const name of toolNames) {
      expect(unregistered).toContain(name);
    }
  });
});
