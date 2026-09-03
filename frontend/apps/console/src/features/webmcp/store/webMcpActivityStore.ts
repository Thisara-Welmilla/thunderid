// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * One thing a WebMCP tool is currently doing, surfaced on screen so the admin can see where the
 * agent is acting rather than watching the console change on its own.
 *
 * @public
 */
export interface WebMcpActivity {
  /**
   * A monotonically increasing id. It changes on every announcement, even when the label repeats, so
   * the spotlight re-runs its highlight for a repeated navigation to the same section.
   */
  id: number;
  /** The user-facing sentence for the status chip. Already localized by the caller. */
  label: string;
  /**
   * The app-relative route (as `RouteConfig` produces it) whose sidebar entry to highlight, e.g.
   * `/flows`. Omitted when the action has no single navigation target to ring, in which case only the
   * chip shows.
   */
  spotlightPath?: string;
  /**
   * True for the "thinking between steps" state shown after a tool finishes, while the agent decides
   * its next action. The chip renders a fixed "thinking" message and no ring; `label` is ignored.
   */
  thinking?: boolean;
}

/**
 * How long the between-steps "thinking" indicator lingers before dismissing itself. Long enough to
 * bridge an agent's reasoning pause, but bounded so it does not sit forever after the final tool call.
 *
 * @internal
 */
const THINKING_TTL_MS = 12_000;

/**
 * How long an announcement stays on screen before it dismisses itself. Long enough to read and to
 * outlast the navigation it describes, short enough that a burst of read calls does not leave a stale
 * chip lingering.
 *
 * @internal
 */
const DEFAULT_TTL_MS = 2200;

/**
 * Module-level activity state, mirroring `guidedJourneyStore`: a plain external store rather than a
 * React context, so any tool (each a plain callback, not a component) can announce without threading
 * a setter through the tool descriptors. One activity is shown at a time; the newest wins, matching
 * the single-operation-at-a-time model the guided journey already enforces.
 */
let state: WebMcpActivity | null = null;
let nextId = 1;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function cancelDismiss(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

/**
 * Subscribes to activity changes, for `useSyncExternalStore`.
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
 * Returns the current activity, for `useSyncExternalStore`. The reference is stable between changes,
 * so a subscribed component does not re-render on unrelated store notifications.
 *
 * @public
 */
export function getSnapshot(): WebMcpActivity | null {
  return state;
}

/**
 * Announces what a tool is doing now. Replaces any current activity and schedules its own dismissal,
 * so callers never have to remember to clear it: a tool that navigates and returns still leaves the
 * chip up long enough to be seen.
 *
 * @param activity - The label to show and, optionally, the route to highlight
 * @param ttlMs - How long to keep it on screen
 *
 * @public
 */
export function announce(activity: {label: string; spotlightPath?: string}, ttlMs: number = DEFAULT_TTL_MS): void {
  cancelDismiss();
  state = {id: nextId, label: activity.label, spotlightPath: activity.spotlightPath};
  nextId += 1;
  emit();
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    state = null;
    emit();
  }, ttlMs);
}

/**
 * Shows the between-steps "thinking" indicator: what fills the gap after a tool returns while the
 * agent reasons about its next call. Auto-dismisses so it never lingers after the last call, and is
 * replaced the instant the next action announces.
 *
 * @public
 */
export function announceThinking(): void {
  cancelDismiss();
  state = {id: nextId, label: '', thinking: true};
  nextId += 1;
  emit();
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    state = null;
    emit();
  }, THINKING_TTL_MS);
}

/**
 * Clears any current activity immediately.
 *
 * @public
 */
export function clearActivity(): void {
  cancelDismiss();
  state = null;
  emit();
}
