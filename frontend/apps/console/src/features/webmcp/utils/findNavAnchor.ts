// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Finds the sidebar link for an app-relative route, e.g. `/flows`. The console router runs under the
 * `/console` basename, so the rendered href is `/console/flows`; matching on the suffix keeps this
 * independent of the basename. Used to highlight and glide to the exact nav item a tool navigates to.
 *
 * @param path - The app-relative route to find
 * @returns The matching element, or `null` when it is not on screen
 *
 * @public
 */
export default function findNavAnchor(path: string): Element | null {
  const anchors = Array.from(document.querySelectorAll('a[href]'));

  return (
    anchors.find((anchor) => {
      const href = anchor.getAttribute('href');
      return href === path || (href?.endsWith(path) ?? false);
    }) ?? null
  );
}
