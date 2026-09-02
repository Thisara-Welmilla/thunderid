// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import getSsoTemplateOptions from '../utils/getSsoTemplateOptions';

describe('getSsoTemplateOptions', () => {
  const options = getSsoTemplateOptions();
  const values = options.map((option) => option.value);
  const templateIds = options.map((option) => option.templateId);

  it('offers the browser and full-stack templates that default to PKCE', () => {
    expect(templateIds).toEqual(expect.arrayContaining(['react', 'vue', 'nextjs', 'nuxt', 'vanilla-js', 'server']));
  });

  it('excludes templates whose defaults omit PKCE', () => {
    // express and node ship authorization_code without pkceRequired, so the tool refuses them
    // rather than silently upgrading a configuration the wizard marks read-only.
    expect(templateIds).not.toContain('express');
    expect(templateIds).not.toContain('node');
  });

  it('excludes machine-to-machine and escape-hatch templates', () => {
    expect(templateIds).not.toContain('backend');
    expect(templateIds).not.toContain('custom');
  });

  it('excludes templates outside this journey', () => {
    expect(templateIds).not.toContain('mcp-client');
    expect(templateIds).not.toContain('wallet');
    expect(templateIds).not.toContain('mobile');
    expect(templateIds).not.toContain('ios');
    expect(templateIds).not.toContain('android');
    expect(templateIds).not.toContain('flutter');
  });

  it('exposes the gallery deep-link value for each option', () => {
    expect(values).toContain('REACT');
    expect(options.every((option) => option.value === option.value.toUpperCase())).toBe(true);
  });

  it('gives every option a display name', () => {
    expect(options.every((option) => option.displayName.length > 0)).toBe(true);
  });
});
