// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useCallback, useRef, useState} from 'react';
import type {PendingToolRead, ToolReadRequest, ToolReadResults} from '../models/tool-reads';

/**
 * How long a read may take before the tool gives up, so a stalled query never leaves the calling
 * agent waiting indefinitely.
 *
 * @internal
 */
const READ_TIMEOUT_MS = 20_000;

/**
 * The read gate handed to the tool implementations.
 *
 * @public
 */
export interface ToolReads {
  /**
   * Reads awaiting a mounted hook. Rendered by `WebMcpProvider` via `ToolReadRunner`.
   */
  pending: PendingToolRead[];
  /**
   * Performs one read, resolving with the data the console's own hook returned.
   */
  read: <K extends ToolReadRequest['kind']>(
    request: Extract<ToolReadRequest, {kind: K}>,
  ) => Promise<ToolReadResults[K]>;
  /**
   * Settles a pending read. Called by `ToolReadRunner`.
   */
  settle: (id: number, outcome: {data?: unknown; error?: Error}) => void;
}

/**
 * Lets a WebMCP tool callback obtain data through the console's own query hooks.
 *
 * A tool's `execute` is a plain async function, so it cannot call `useGetApplication` itself. It
 * queues a read here instead; `WebMcpProvider` renders a `ToolReadRunner` for each queued read,
 * which mounts the real hook and reports back. The tool therefore shares the UI's query keys and
 * cache rather than issuing a parallel request that could disagree with what is on screen.
 *
 * @returns The read gate
 *
 * @public
 */
export default function useToolReads(): ToolReads {
  const [pending, setPending] = useState<PendingToolRead[]>([]);
  const nextIdRef = useRef(0);
  const waitersRef = useRef(new Map<number, (outcome: {data?: unknown; error?: Error}) => void>());

  const settle = useCallback((id: number, outcome: {data?: unknown; error?: Error}): void => {
    const waiter = waitersRef.current.get(id);
    if (!waiter) {
      return;
    }

    waitersRef.current.delete(id);
    setPending((current) => current.filter((entry) => entry.id !== id));
    waiter(outcome);
  }, []);

  const read = useCallback(
    async <K extends ToolReadRequest['kind']>(
      request: Extract<ToolReadRequest, {kind: K}>,
    ): Promise<ToolReadResults[K]> => {
      nextIdRef.current += 1;
      const id = nextIdRef.current;

      const outcome = await new Promise<{data?: unknown; error?: Error}>((resolve) => {
        const timer = setTimeout(() => {
          settle(id, {error: new Error(`Timed out reading ${request.kind}.`)});
        }, READ_TIMEOUT_MS);

        waitersRef.current.set(id, (settled) => {
          clearTimeout(timer);
          resolve(settled);
        });

        setPending((current) => [...current, {id, request}]);
      });

      if (outcome.error) {
        throw outcome.error;
      }

      return outcome.data as ToolReadResults[K];
    },
    [settle],
  );

  return {pending, read, settle};
}
