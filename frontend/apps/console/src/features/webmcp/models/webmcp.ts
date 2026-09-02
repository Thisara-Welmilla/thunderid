// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal typings for the browser-native WebMCP surface
 * (`document.modelContext` / `navigator.modelContext`).
 *
 * WebMCP is a W3C Web Machine Learning CG draft and is not in `lib.dom.d.ts`, so the shape the
 * console depends on is declared here rather than pulled from a dependency. Everything the console
 * touches is optional and feature-detected (see `getModelContext`), so a browser that exposes a
 * different or partial implementation degrades to "no tools registered" instead of throwing.
 *
 * This is deliberately *not* the transport used by the backend MCP server
 * (`backend/internal/<domain>/tools.go`), which serves remote agents over the wire. These tools run inside
 * the admin's own authenticated console tab and drive the console's UI.
 *
 * @public
 */

/**
 * A single content block in a tool's response, as consumed by the calling agent.
 */
export interface WebMcpToolContent {
  type: 'text';
  text: string;
}

/**
 * A tool's response.
 */
export interface WebMcpToolResult {
  content: WebMcpToolContent[];
  /**
   * Whether the call failed. Set for a refused precondition or a rejected input so the agent can
   * narrate the reason instead of treating the message as a success payload.
   */
  isError?: boolean;
}

/**
 * Hints describing a tool's behaviour, mirroring the `mcp.ToolAnnotations` the backend Go tools
 * already set (see `backend/internal/ou/tools.go`).
 */
export interface WebMcpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
}

/**
 * A tool as handed to `registerTool`.
 */
export interface WebMcpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: WebMcpToolAnnotations;
  execute: (args: Record<string, unknown>) => Promise<WebMcpToolResult>;
}

/**
 * The `modelContext` object exposed by a WebMCP-capable browser.
 */
export interface WebMcpModelContext {
  registerTool?: (tool: WebMcpToolDescriptor) => {unregister?: () => void} | void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: {tools: WebMcpToolDescriptor[]}) => void;
  /**
   * Asks the agent to hand control back to the user, bringing the page to the foreground before a
   * confirmation is shown. Optional in every implementation seen so far, so every mutating tool
   * still renders its own in-console confirmation and never relies on this alone.
   */
  requestUserInteraction?: () => Promise<void> | void;
}

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }

  interface Navigator {
    modelContext?: WebMcpModelContext;
  }
}
