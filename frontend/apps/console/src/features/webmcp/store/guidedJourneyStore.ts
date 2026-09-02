// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {GuidedApplicationResult, GuidedOperation, WebMcpRefusal} from '../models/journey';

/**
 * Where the in-flight guided operation has got to.
 *
 * @public
 */
export const GuidedPhases = {
  /** Nothing in flight. */
  IDLE: 'IDLE',
  /** The tool has navigated, and is waiting for the target page to mount and take the draft. */
  PREFILLING: 'PREFILLING',
  /** The page is on screen with the draft applied, awaiting the admin's confirmation. */
  READY: 'READY',
  /** The admin confirmed; the page's own submit handler is running. */
  SUBMITTING: 'SUBMITTING',
} as const;

/**
 * Guided phase type.
 *
 * @public
 */
export type GuidedPhase = (typeof GuidedPhases)[keyof typeof GuidedPhases];

/**
 * How a guided operation ended: with the affected application, or with a refusal.
 *
 * @public
 */
export type GuidedOutcome = GuidedApplicationResult | WebMcpRefusal;

/**
 * Whether a settled outcome is a refusal rather than a result.
 *
 * @param outcome - The settled outcome
 * @returns Whether the operation refused or failed
 *
 * @public
 */
export function isRefusal(outcome: GuidedOutcome): outcome is WebMcpRefusal {
  return 'code' in outcome;
}

/**
 * The store's public snapshot.
 *
 * @public
 */
export interface GuidedJourneyState {
  phase: GuidedPhase;
  operation: GuidedOperation | null;
}

const IDLE_STATE: GuidedJourneyState = {phase: GuidedPhases.IDLE, operation: null};

/**
 * Module-level state bridging a WebMCP tool to the page that has to carry the change out.
 *
 * This is deliberately not a React context. `ApplicationCreateProvider` is mounted only around the
 * `applications/types` and `applications/create` routes (see `App.tsx`), so it does not exist at the
 * point `WebMcpProvider` runs - and it is *mounted by* the very navigation the tool performs. The
 * draft therefore has to survive that navigation, which a provider above the router could only
 * manage by hoisting `ApplicationCreateProvider` to the whole app. The same holds for the
 * application edit page's local form state.
 *
 * One operation is in flight at a time: the confirmation gate already refuses a second concurrent
 * mutating call, and a guided journey is a narrated sequence, not a fan-out.
 */
let state: GuidedJourneyState = IDLE_STATE;
const listeners = new Set<() => void>();

/**
 * The in-flight operation's single settler. It resolves - never rejects - with either the result or
 * a refusal, so a tool that abandons the operation without awaiting it (the admin declined at the
 * confirmation, say) cannot leave an unhandled rejection behind.
 */
let settleOutcome: ((outcome: GuidedOutcome) => void) | null = null;
let notifyPrefilled: (() => void) | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: GuidedJourneyState): void {
  state = next;
  emit();
}

function clearPending(): void {
  settleOutcome = null;
  notifyPrefilled = null;
}

/**
 * Subscribes to store changes, for `useSyncExternalStore`.
 *
 * @param listener - Called on every state change
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
 * Returns the current snapshot, for `useSyncExternalStore`.
 *
 * @public
 */
export function getSnapshot(): GuidedJourneyState {
  return state;
}

/**
 * Starts a guided operation. The returned promise settles when the page's own mutation succeeds,
 * when it fails, or when the admin declines.
 *
 * @param operation - The validated change the console is about to make
 * @returns The affected application's identifiers
 *
 * @public
 */
export function begin(operation: GuidedOperation): Promise<GuidedOutcome> {
  clearPending();
  setState({phase: GuidedPhases.PREFILLING, operation});

  return new Promise<GuidedOutcome>((resolve) => {
    settleOutcome = resolve;
  });
}

/**
 * Signalled by the page once it has taken the draft into its own form state.
 *
 * @public
 */
export function markPrefilled(): void {
  if (state.phase !== GuidedPhases.PREFILLING) {
    return;
  }

  setState({...state, phase: GuidedPhases.READY});
  notifyPrefilled?.();
  notifyPrefilled = null;
}

/**
 * Waits for the target page to mount and take the draft.
 *
 * @param timeoutMs - How long to wait before giving up
 * @returns Whether the page took the draft in time
 *
 * @public
 */
export function waitUntilPrefilled(timeoutMs: number): Promise<boolean> {
  if (state.phase === GuidedPhases.READY) {
    return Promise.resolve(true);
  }

  if (state.phase === GuidedPhases.IDLE) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      notifyPrefilled = null;
      resolve(false);
    }, timeoutMs);

    notifyPrefilled = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
}

/**
 * Releases the page to run its own submit handler, after the admin has confirmed.
 *
 * @public
 */
export function requestSubmit(): void {
  if (state.phase !== GuidedPhases.READY) {
    return;
  }

  setState({...state, phase: GuidedPhases.SUBMITTING});
}

/**
 * Settles the in-flight operation with the application it affected.
 *
 * @param result - The affected application's identifiers
 *
 * @public
 */
export function settleSuccess(result: GuidedApplicationResult): void {
  const settle = settleOutcome;
  clearPending();
  setState(IDLE_STATE);
  settle?.(result);
}

/**
 * Settles the in-flight operation as refused or failed.
 *
 * @param refusal - Why it did not complete
 *
 * @public
 */
export function settleFailure(refusal: WebMcpRefusal): void {
  const settle = settleOutcome;
  clearPending();
  setState(IDLE_STATE);
  settle?.(refusal);
}
