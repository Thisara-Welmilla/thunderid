// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolves after `ms` milliseconds, or immediately when `ms <= 0`. The single place the WebMCP tools
 * wait, so pacing is off (instant) whenever the speed resolves to zero delays.
 *
 * @param ms - How long to wait
 * @returns A promise that resolves after the delay
 *
 * @public
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Applies `text` to a setter one character at a time, waiting `perCharMs` between each, so a value
 * appears typed rather than pasted. With `perCharMs <= 0` it applies the whole string once, which is
 * exactly the un-paced behavior.
 *
 * @param apply - Receives the growing prefix of the text
 * @param text - The full value to type
 * @param perCharMs - Delay between characters
 *
 * @public
 */
export async function typeInto(apply: (value: string) => void, text: string, perCharMs: number): Promise<void> {
  if (perCharMs <= 0 || text.length === 0) {
    apply(text);
    return;
  }

  let typed = '';
  for (const char of text) {
    typed += char;
    apply(typed);
    await sleep(perCharMs);
  }
}
