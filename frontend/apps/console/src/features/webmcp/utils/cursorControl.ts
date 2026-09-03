// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {sleep} from './pacing';
import {getSnapshot, moveCursor, placeCursor, pulseCursor, setCursorTarget} from '../store/webMcpCursorStore';

/**
 * The testid the confirmation dialog puts on its accept button, so the pointer can point at it.
 *
 * @internal
 */
const CONFIRM_ACCEPT_SELECTOR = '[data-testid="webmcp-confirm-accept"]';

function centerOf(element: Element): {x: number; y: number} {
  const rect = element.getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Glides the fake pointer to the centre of an element. On the first move it seeds a start position
 * away from the target so the glide is visible rather than the pointer just appearing on it.
 *
 * @param element - The element to glide to
 * @param moveMs - Glide duration
 * @param options - `highlight: true` also rings the element in amber (used for buttons, where nothing
 *   else highlights it; navigation leaves it off because the spotlight already rings the nav item)
 *
 * @public
 */
export async function glideToElement(
  element: Element,
  moveMs: number,
  options: {highlight?: boolean} = {},
): Promise<void> {
  setCursorTarget(options.highlight ? element : null);

  const {x, y} = centerOf(element);

  if (!getSnapshot().visible) {
    const startX = typeof window !== 'undefined' ? window.innerWidth / 2 : x;
    const startY = typeof window !== 'undefined' ? window.innerHeight * 0.78 : y;
    placeCursor(startX, startY);
    await nextFrame();
  }

  await moveCursor(x, y, moveMs);
}

/**
 * Points the pointer at the confirmation dialog's accept button and rings it, so the button the admin
 * should press is highlighted. Waits a beat for the dialog to render, and is a no-op if it is not
 * there. Never clicks it: the admin still confirms.
 *
 * @param moveMs - Glide duration
 *
 * @public
 */
export async function pointAtConfirmButton(moveMs: number): Promise<void> {
  // Let the dialog mount before looking for its button.
  await sleep(150);
  const button = document.querySelector(CONFIRM_ACCEPT_SELECTOR);
  if (button) {
    await glideToElement(button, moveMs, {highlight: true});
  }
}

/**
 * Shows a click pulse at the pointer's current position.
 *
 * @public
 */
export async function clickPulse(): Promise<void> {
  await pulseCursor();
}
