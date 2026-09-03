// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';
import ConsoleSections from '../constants/console-sections';
import WebMcpTools from '../constants/webmcp-tools';
import {WebMcpRefusalCodes} from '../models/journey';
import type {WebMcpToolDescriptor, WebMcpToolResult} from '../models/webmcp';
import {announce} from '../store/webMcpActivityStore';
import {clickPulse, glideToElement} from '../utils/cursorControl';
import findNavAnchor from '../utils/findNavAnchor';
import {sleep} from '../utils/pacing';
import {asRefusal, toolRefusal, toolSuccess} from '../utils/toolResults';
import {getWebMcpTimings} from '../utils/webMcpSpeed';

/**
 * Builds the WebMCP tools that let an agent move the admin's console around, so a guided quickstart
 * can narrate where it is taking the admin and the UI follows: "opening Login Flows" and the console
 * is on Login Flows.
 *
 * Two tools, deliberately split so discovery is a distinct, read-only step from the act of moving:
 *
 * - {@link WebMcpTools.LIST_SECTIONS} hands back the navigable sections. It is `readOnlyHint` because
 *   it only describes the console, changing nothing.
 * - {@link WebMcpTools.NAVIGATE} moves the console to one section. It is not `readOnlyHint`: it
 *   changes what is on screen. It stays unconfirmed all the same, because it only navigates to a
 *   landing page and writes nothing, so there is no destructive action to gate; the mutating journey
 *   tools keep their own confirmation dialogs.
 *
 * These sit alongside the "Set up SSO for my app" tools from `useSsoJourneyTools`, registered
 * together by `WebMcpJourney`. They share the `thunderid_console_` prefix for the same reason: they
 * drive the live console, not the management API, and must not be confused with the backend MCP
 * tools.
 *
 * @returns The navigation tools to register
 *
 * @public
 */
export default function useConsoleNavigationTools(): WebMcpToolDescriptor[] {
  const navigate = useNavigate();
  const {t} = useTranslation();

  const sectionIds = useMemo(() => ConsoleSections.map((section) => section.id), []);

  const listSections = useCallback(
    (): Promise<WebMcpToolResult> =>
      Promise.resolve(
        toolSuccess({
          sections: ConsoleSections.map(({id, title, description, path}) => ({id, title, description, path})),
        }),
      ),
    [],
  );

  const navigateToSection = useCallback(
    async (args: Record<string, unknown>): Promise<WebMcpToolResult> => {
      const requested = typeof args.section === 'string' ? args.section.trim() : '';
      const section = ConsoleSections.find((entry) => entry.id.toLowerCase() === requested.toLowerCase());

      if (!section) {
        return toolRefusal({
          code: WebMcpRefusalCodes.SECTION_NOT_FOUND,
          message:
            `"${String(args.section)}" is not a console section. Call ${WebMcpTools.LIST_SECTIONS} to see the ` +
            'sections that can be navigated to.',
          details: {sections: sectionIds},
        });
      }

      try {
        // Announce before navigating so the ring lands on the sidebar item the admin is about to be
        // taken to, making the move visible rather than the page just changing under them.
        announce({
          label: t('common:webmcp.spotlight.opening', 'Opening {{section}}', {section: section.title}),
          spotlightPath: section.path,
        });

        // When paced, glide the fake pointer to the sidebar item and pause before "clicking" it, so
        // the move is watchable. At the default `off` speed this is skipped and navigation is instant.
        const timings = getWebMcpTimings();
        if (timings.enabled) {
          const target = findNavAnchor(section.path);
          if (target) {
            await glideToElement(target, timings.cursorMoveMs);
            await sleep(timings.preClickMs);
            await clickPulse();
          } else {
            await sleep(timings.preClickMs);
          }
        }

        await navigate(section.path);

        return toolSuccess({
          navigatedTo: section.id,
          title: section.title,
          path: section.path,
          message: `The console is now showing ${section.title}.`,
        });
      } catch (error) {
        return toolRefusal(
          asRefusal(error, {
            code: WebMcpRefusalCodes.REQUEST_FAILED,
            message: `Could not navigate to ${section.title}.`,
          }),
        );
      }
    },
    [navigate, sectionIds, t],
  );

  return useMemo<WebMcpToolDescriptor[]>(
    () => [
      {
        name: WebMcpTools.LIST_SECTIONS,
        description:
          'List the top-level console sections that can be navigated to, each with an id, a title, a one-line ' +
          `description, and its path. Call this first to discover valid ids for ${WebMcpTools.NAVIGATE}.`,
        inputSchema: {type: 'object', properties: {}, additionalProperties: false},
        annotations: {title: 'List Console Sections', readOnlyHint: true},
        execute: listSections,
      },
      {
        name: WebMcpTools.NAVIGATE,
        description:
          "Move the admin's console to a section by id, so a quickstart can show where it is going. This only " +
          'changes the page on screen; it reads and writes no data, and never opens a create wizard or a specific ' +
          `record. Refuses an unknown id and returns the valid ones. Use ${WebMcpTools.LIST_SECTIONS} to discover them.`,
        inputSchema: {
          type: 'object',
          properties: {
            section: {
              type: 'string',
              enum: sectionIds,
              description: 'The id of the section to open.',
            },
          },
          required: ['section'],
          additionalProperties: false,
        },
        annotations: {title: 'Navigate Console', readOnlyHint: false},
        execute: navigateToSection,
      },
    ],
    [listSections, navigateToSection, sectionIds],
  );
}
