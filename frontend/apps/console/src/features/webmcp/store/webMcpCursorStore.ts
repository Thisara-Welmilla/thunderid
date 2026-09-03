// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The fake pointer's on-screen state, driven by the WebMCP tools so a person can see where the agent
 * is about to act. Purely cosmetic: it dispatches no events and moving it clicks nothing.
 *
 * @public
 */
export interface WebMcpCursorState {
  visible: boolean;
  /** Viewport coordinates of the pointer tip. */
  x: number;
  y: number;
  /** Transition duration for the current move; `0` places the pointer with no glide. */
  moveMs: number;
  /** Whether a click pulse is showing. */
  clicking: boolean;
  /** The element the pointer is heading to, ringed in amber while set. `null` for none. */
  targetEl: Element | null;
}

const HIDDEN: WebMcpCursorState = {visible: false, x: 0, y: 0, moveMs: 0, clicking: false, targetEl: null};

let state: WebMcpCursorState = HIDDEN;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: WebMcpCursorState): void {
  state = next;
  emit();
}

/**
 * Subscribes to cursor changes, for `useSyncExternalStore`.
 *
 * @param listener - Called on every change
 * @returns An unsubscribe function
 *
 * @public
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns the current cursor state, for `useSyncExternalStore`.
 *
 * @public
 */
export function getSnapshot(): WebMcpCursorState {
  return state;
}

/**
 * Places the pointer at a point with no glide, e.g. to seed its start position before the first move.
 *
 * @param x - Viewport x
 * @param y - Viewport y
 *
 * @public
 */
export function placeCursor(x: number, y: number): void {
  setState({...state, visible: true, x, y, moveMs: 0, clicking: false});
}

/**
 * Sets (or clears) the element the pointer is aiming at, which the cursor overlay rings in amber.
 *
 * @param element - The target element, or `null` to clear the ring
 *
 * @public
 */
export function setCursorTarget(element: Element | null): void {
  setState({...state, targetEl: element});
}

/**
 * Glides the pointer to a point over `moveMs`, resolving once the glide should be complete.
 *
 * @param x - Target viewport x
 * @param y - Target viewport y
 * @param moveMs - Glide duration
 * @returns A promise that resolves after the glide
 *
 * @public
 */
export function moveCursor(x: number, y: number, moveMs: number): Promise<void> {
  setState({...state, visible: true, x, y, moveMs, clicking: false});
  return new Promise((resolve) => {
    if (moveMs <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, moveMs);
  });
}

/**
 * Shows a brief click pulse at the pointer, resolving once it has been on screen long enough to read.
 *
 * @param holdMs - How long the pulse shows
 * @returns A promise that resolves after the pulse
 *
 * @public
 */
export function pulseCursor(holdMs = 260): Promise<void> {
  setState({...state, visible: true, clicking: true});
  return new Promise((resolve) => {
    setTimeout(() => {
      setState({...state, clicking: false});
      resolve();
    }, holdMs);
  });
}

/**
 * Hides the pointer.
 *
 * @public
 */
export function hideCursor(): void {
  setState(HIDDEN);
}
