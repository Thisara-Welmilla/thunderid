// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Parses a comma-separated string into a trimmed, non-empty string array.
 */
export const parseCommaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Coerces a raw field value into a whole number within the given bounds.
 *
 * Intended as a {@link DraftTextField} `normalize` callback, so it runs once the user is
 * done editing rather than per keystroke — a field that clamps mid-typing fights anyone
 * entering a value digit by digit.
 *
 * @param raw - The raw field text.
 * @param min - Lower bound, and the value an empty field falls back to.
 * @param max - Upper bound, if the property has one.
 * @returns The clamped value as text, or `null` when the input is not a number.
 */
export const clampToInteger = (raw: string, min: number, max?: number): string | null => {
  if (raw.trim() === '') {
    return String(min);
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const floored = Math.max(min, Math.floor(parsed));

  return String(max === undefined ? floored : Math.min(max, floored));
};
