// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {renderHook} from '@thunderid/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ConsoleSections from '../constants/console-sections';
import WebMcpTools from '../constants/webmcp-tools';
import useConsoleNavigationTools from '../hooks/useConsoleNavigationTools';
import {WebMcpRefusalCodes} from '../models/journey';
import type {WebMcpToolDescriptor, WebMcpToolResult} from '../models/webmcp';

const mockNavigate = vi.fn(() => Promise.resolve());

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {...actual, useNavigate: () => mockNavigate};
});

function payloadOf(result: WebMcpToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function renderTools(): {tool: (name: string) => WebMcpToolDescriptor} {
  const {result} = renderHook(() => useConsoleNavigationTools());

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

describe('useConsoleNavigationTools', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers exactly the list-sections and navigate tools', () => {
    const {result} = renderHook(() => useConsoleNavigationTools());

    expect(result.current.map((tool) => tool.name)).toEqual([WebMcpTools.LIST_SECTIONS, WebMcpTools.NAVIGATE]);
  });

  describe('list sections', () => {
    it('is read-only and lists every section with id, title, description, and path', async () => {
      const {tool} = renderTools();
      const listSections = tool(WebMcpTools.LIST_SECTIONS);

      expect(listSections.annotations?.readOnlyHint).toBe(true);

      const result = await listSections.execute({});
      const {sections} = payloadOf(result) as {sections: Record<string, unknown>[]};

      expect(sections).toHaveLength(ConsoleSections.length);
      expect(sections[0]).toEqual({
        id: ConsoleSections[0].id,
        title: ConsoleSections[0].title,
        description: ConsoleSections[0].description,
        path: ConsoleSections[0].path,
      });
      expect(sections.map((section) => section.id)).toEqual(expect.arrayContaining(['applications', 'flows', 'users']));
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('navigate', () => {
    it('constrains its input schema to the known section ids', () => {
      const {tool} = renderTools();
      const navigate = tool(WebMcpTools.NAVIGATE);

      const schema = navigate.inputSchema as {properties: {section: {enum: string[]}}};

      expect(schema.properties.section.enum).toEqual(ConsoleSections.map((section) => section.id));
      expect(navigate.annotations?.readOnlyHint).toBe(false);
    });

    it('navigates to the section path and reports where it landed', async () => {
      const {tool} = renderTools();
      const flows = ConsoleSections.find((section) => section.id === 'flows')!;

      const result = await tool(WebMcpTools.NAVIGATE).execute({section: 'flows'});

      expect(mockNavigate).toHaveBeenCalledWith(flows.path);
      expect(result.isError).toBeUndefined();
      expect(payloadOf(result)).toMatchObject({navigatedTo: 'flows', title: flows.title, path: flows.path});
    });

    it('matches section ids case-insensitively and after trimming', async () => {
      const {tool} = renderTools();
      const applications = ConsoleSections.find((section) => section.id === 'applications')!;

      await tool(WebMcpTools.NAVIGATE).execute({section: '  Applications  '});

      expect(mockNavigate).toHaveBeenCalledWith(applications.path);
    });

    it('refuses an unknown section without navigating, returning the valid ids', async () => {
      const {tool} = renderTools();

      const result = await tool(WebMcpTools.NAVIGATE).execute({section: 'nope'});

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      const refusal = payloadOf(result) as {code: string; details: {sections: string[]}};
      expect(refusal.code).toBe(WebMcpRefusalCodes.SECTION_NOT_FOUND);
      expect(refusal.details.sections).toEqual(ConsoleSections.map((section) => section.id));
    });

    it('surfaces a failed navigation as a refusal rather than throwing', async () => {
      mockNavigate.mockRejectedValueOnce(new Error('router blew up'));
      const {tool} = renderTools();

      const result = await tool(WebMcpTools.NAVIGATE).execute({section: 'home'});

      expect(result.isError).toBe(true);
      expect((payloadOf(result) as {code: string}).code).toBe(WebMcpRefusalCodes.REQUEST_FAILED);
    });
  });
});
