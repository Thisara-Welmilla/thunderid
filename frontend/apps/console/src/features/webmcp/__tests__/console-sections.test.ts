// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import ConsoleSections from '../constants/console-sections';

describe('ConsoleSections', () => {
  it('has unique ids so the navigate tool can resolve one section per id', () => {
    const ids = ConsoleSections.map((section) => section.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every section an app-relative path, a title, and a description', () => {
    for (const section of ConsoleSections) {
      expect(section.path.startsWith('/')).toBe(true);
      expect(section.path.startsWith('/console')).toBe(false);
      expect(section.title.trim()).not.toBe('');
      expect(section.description.trim()).not.toBe('');
    }
  });
});
