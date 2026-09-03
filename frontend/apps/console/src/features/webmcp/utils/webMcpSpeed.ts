// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * How fast the WebMCP tools animate their actions: instant (`off`, the default and today's
 * behavior), or a paced `slow` / `normal` / `fast` that types text out, glides a pointer to each
 * target, and pauses briefly before committing, so a person can watch the agent operate the console.
 *
 * @public
 */
export type WebMcpSpeed = 'off' | 'slow' | 'normal' | 'fast';

/**
 * The concrete delays a speed resolves to.
 *
 * @public
 */
export interface WebMcpTimings {
  /** Whether any pacing applies. `false` for `off`, in which case every delay below is `0`. */
  enabled: boolean;
  /** Delay between characters when typing text into a field. */
  perCharMs: number;
  /** Pause held after a target is reached, before the action commits, so the click reads as deliberate. */
  preClickMs: number;
  /** How long the pointer takes to glide from its last position to a target. */
  cursorMoveMs: number;
}

const TIMINGS: Record<WebMcpSpeed, WebMcpTimings> = {
  off: {enabled: false, perCharMs: 0, preClickMs: 0, cursorMoveMs: 0},
  slow: {enabled: true, perCharMs: 100, preClickMs: 1200, cursorMoveMs: 2600},
  normal: {enabled: true, perCharMs: 55, preClickMs: 650, cursorMoveMs: 1500},
  fast: {enabled: true, perCharMs: 25, preClickMs: 260, cursorMoveMs: 750},
};

const STORAGE_KEY = 'webmcpSpeed';

function isSpeed(value: string | null): value is WebMcpSpeed {
  return value === 'off' || value === 'slow' || value === 'normal' || value === 'fast';
}

/**
 * The current WebMCP animation speed. `?webmcpSpeed=` in the URL wins and is persisted to
 * `localStorage` so it survives navigation; otherwise the stored value is used; otherwise `off`.
 *
 * @returns The resolved speed
 *
 * @public
 */
export function getWebMcpSpeed(): WebMcpSpeed {
  try {
    const fromUrl =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(STORAGE_KEY) : null;

    if (isSpeed(fromUrl)) {
      try {
        localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch {
        // A blocked localStorage still lets the URL value apply for this page.
      }
      return fromUrl;
    }

    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (isSpeed(stored)) {
      return stored;
    }
  } catch {
    // An odd URL or blocked storage means no override; fall through to the default.
  }

  return 'off';
}

/**
 * The delays for the current speed.
 *
 * @returns The resolved timings
 *
 * @public
 */
export function getWebMcpTimings(): WebMcpTimings {
  return TIMINGS[getWebMcpSpeed()];
}
