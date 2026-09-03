// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useEffect} from 'react';
import type {WebMcpModelContext, WebMcpToolDescriptor} from '../models/webmcp';
import {announceThinking} from '../store/webMcpActivityStore';
import getModelContext from '../utils/getModelContext';
import {getWebMcpTimings} from '../utils/webMcpSpeed';

/**
 * Wraps a tool so that, once it finishes, the "thinking about the next step" indicator fills the gap
 * while the agent reasons about its next call, keeping the screen alive rather than going dead
 * between calls. The next tool's own announcement replaces it. Only when pacing is enabled, so the
 * default `off` speed is unchanged. The tool's return value and errors pass through untouched.
 */
function withThinkingHandoff(tool: WebMcpToolDescriptor): WebMcpToolDescriptor {
  return {
    ...tool,
    execute: async (args) => {
      try {
        return await tool.execute(args);
      } finally {
        if (getWebMcpTimings().enabled) {
          announceThinking();
        }
      }
    },
  };
}

/**
 * How often, and for how long, to keep looking for a model context that is not there yet. A bridge or
 * Chrome's own WebMCP surface can attach a beat after the console mounts, so we poll for a bounded
 * window rather than checking once. We also re-check when the tab regains focus, which is when a
 * bridge that swaps the context is most likely to have done so.
 *
 * @internal
 */
const POLL_INTERVAL_MS = 1000;
const POLL_WINDOW_MS = 20_000;

/**
 * Swallows a rejected promise so an async API (Chrome's built-in `registerTool` is async and rejects
 * on a duplicate name) never surfaces as an uncaught rejection. Synchronous return values pass
 * through untouched.
 */
function ignoreRejection(result: unknown): void {
  if (result && typeof (result as {then?: unknown}).then === 'function') {
    (result as Promise<unknown>).then(undefined, () => undefined);
  }
}

/**
 * Registers the given WebMCP tools with the browser's model context and keeps them registered.
 *
 * Registration happens once per distinct model context. Native WebMCP enforces unique tool names and
 * its `registerTool` is asynchronous, so blindly re-registering, for example on every poll tick,
 * races its own teardown and throws "Duplicate tool name". Instead we remember which context we have
 * published to and only re-publish when a *different* one appears (a late attach, or a bridge that
 * swaps the context), tearing the previous registration down first.
 *
 * Publishing uses the spec's per-tool `registerTool` when present, falling back to the legacy bulk
 * `provideContext({tools})` for a surface that exposes only that. Methods are bound to the context:
 * the native `ModelContext` is a host object whose methods throw "Illegal invocation" when called
 * detached (`const {registerTool} = modelContext`), even though a plain-object polyfill tolerates it.
 *
 * Everything is feature-detected and wrapped, so a browser without WebMCP, or one exposing a partial
 * surface, degrades to "no tools published" instead of throwing. No logging: no `LoggerProvider` is
 * mounted above this hook's consumer (see `App.tsx`).
 *
 * @param tools - The tools to keep registered
 *
 * @public
 */
export default function useRegisterWebMcpTools(tools: WebMcpToolDescriptor[]): void {
  useEffect(() => {
    const noop = (): void => undefined;
    let disposed = false;
    let publishedTo: WebMcpModelContext | null = null;
    let teardown = noop;

    const publishTo = (modelContext: WebMcpModelContext): boolean => {
      try {
        teardown();
      } catch {
        // Best-effort: a failed teardown must not stop the registration below.
      }
      teardown = noop;

      const registerTool =
        typeof modelContext.registerTool === 'function' ? modelContext.registerTool.bind(modelContext) : null;
      const unregisterTool =
        typeof modelContext.unregisterTool === 'function' ? modelContext.unregisterTool.bind(modelContext) : null;
      const provideContext =
        typeof modelContext.provideContext === 'function' ? modelContext.provideContext.bind(modelContext) : null;

      if (registerTool) {
        const handles: {unregister: () => void}[] = [];
        const registeredNames: string[] = [];

        for (const tool of tools) {
          try {
            const registration = registerTool(withThinkingHandoff(tool)) as {unregister?: () => void} | undefined;
            ignoreRejection(registration);
            registeredNames.push(tool.name);

            if (registration && typeof registration.unregister === 'function') {
              handles.push(registration as {unregister: () => void});
            }
          } catch {
            // A partial or differently-shaped WebMCP must not break the console: a failed
            // registration drops that one tool rather than the whole set.
          }
        }

        teardown = () => {
          for (const handle of handles) {
            try {
              handle.unregister();
            } catch {
              // Teardown is best-effort.
            }
          }
          if (unregisterTool) {
            for (const name of registeredNames) {
              try {
                ignoreRejection(unregisterTool(name));
              } catch {
                // Teardown is best-effort.
              }
            }
          }
        };
        return true;
      }

      if (provideContext) {
        try {
          ignoreRejection(provideContext({tools: tools.map(withThinkingHandoff)}));
        } catch {
          // A malformed bulk-publish must not break the console.
        }

        teardown = () => {
          try {
            // Publish an empty set: the bulk-API equivalent of unregistering every tool.
            ignoreRejection(provideContext({tools: []}));
          } catch {
            // Teardown is best-effort.
          }
        };
        return true;
      }

      return false;
    };

    const reassert = (): void => {
      if (disposed) {
        return;
      }

      const modelContext = getModelContext();
      if (!modelContext) {
        // The context went away; allow a re-publish if it comes back.
        publishedTo = null;
        return;
      }
      if (modelContext === publishedTo) {
        // Already registered with this exact context. Re-registering here is what throws
        // "Duplicate tool name" against native WebMCP, so it is deliberately skipped.
        return;
      }
      if (publishTo(modelContext)) {
        publishedTo = modelContext;
      }
    };

    reassert();

    // Poll for a late-attaching context for a bounded window, then stop rather than churn forever.
    let elapsed = 0;
    const pollTimer = setInterval(() => {
      elapsed += POLL_INTERVAL_MS;
      if (disposed || elapsed >= POLL_WINDOW_MS) {
        clearInterval(pollTimer);
        return;
      }
      reassert();
    }, POLL_INTERVAL_MS);

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', reassert);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', reassert);
    }

    return () => {
      disposed = true;
      clearInterval(pollTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', reassert);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', reassert);
      }
      try {
        teardown();
      } catch {
        // Teardown is best-effort: the page is going away regardless.
      }
    };
  }, [tools]);
}
