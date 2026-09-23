// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, it, expect} from 'vitest';
import {collectWarnings, parseTokens, resolveForPreview} from '../templateTokens';

describe('parseTokens', () => {
  it('classifies t, design and ctx tokens with their keys', () => {
    const tokens = parseTokens('{{t(otp.subject)}} {{design(palette.primary.main)}} {{ctx(otp)}}');
    expect(tokens).toEqual([
      {raw: '{{t(otp.subject)}}', kind: 't', key: 'otp.subject'},
      {raw: '{{design(palette.primary.main)}}', kind: 'design', key: 'palette.primary.main'},
      {raw: '{{ctx(otp)}}', kind: 'ctx', key: 'otp'},
    ]);
  });

  it('marks an unknown function as unsupported', () => {
    expect(parseTokens('{{meta(application.name)}}')).toEqual([{raw: '{{meta(application.name)}}', kind: null}]);
  });

  it('marks a token with inner spaces as unsupported', () => {
    expect(parseTokens('{{ t(otp.subject) }}')).toEqual([{raw: '{{ t(otp.subject) }}', kind: null}]);
  });

  it('marks a key with a disallowed character (colon) as unsupported', () => {
    expect(parseTokens('{{t(ns:key)}}')).toEqual([{raw: '{{t(ns:key)}}', kind: null}]);
  });

  it('returns an empty list when there are no tokens', () => {
    expect(parseTokens('plain text')).toEqual([]);
  });
});

describe('resolveForPreview', () => {
  const translations = {'otp.subject': 'Your verification code'};

  it('returns an empty string for undefined input', () => {
    expect(resolveForPreview(undefined, translations)).toBe('');
  });

  it('substitutes a translation token with its value', () => {
    expect(resolveForPreview('{{t(otp.subject)}}', translations)).toBe('Your verification code');
  });

  it('leaves a translation token literal when no translation exists', () => {
    expect(resolveForPreview('{{t(missing.key)}}', translations)).toBe('{{t(missing.key)}}');
  });

  it('leaves ctx and design tokens untouched', () => {
    expect(resolveForPreview('{{ctx(otp)}} {{design(palette.primary.main)}}', translations)).toBe(
      '{{ctx(otp)}} {{design(palette.primary.main)}}',
    );
  });

  it('leaves a malformed token untouched', () => {
    expect(resolveForPreview('{{meta(application.name)}}', translations)).toBe('{{meta(application.name)}}');
  });
});

describe('collectWarnings', () => {
  const translations = {'otp.subject': 'Your verification code'};

  it('reports no warnings for supported, resolvable tokens', () => {
    const warnings = collectWarnings({
      channel: 'email',
      subject: '{{t(otp.subject)}}',
      body: '<p>{{ctx(otp)}}</p>',
      translations,
    });
    expect(warnings).toEqual([]);
  });

  it('reports an unsupported token as an error', () => {
    const warnings = collectWarnings({channel: 'email', body: '{{meta(application.name)}}', translations});
    expect(warnings).toEqual([{severity: 'error', code: 'unsupported', token: '{{meta(application.name)}}'}]);
  });

  it('reports a design token in the subject as not allowed', () => {
    const warnings = collectWarnings({
      channel: 'email',
      subject: '{{design(palette.primary.main)}}',
      body: 'hi',
      translations,
    });
    expect(warnings).toContainEqual({
      severity: 'error',
      code: 'designNotAllowed',
      token: '{{design(palette.primary.main)}}',
    });
  });

  it('reports a design token in an SMS body as not allowed', () => {
    const warnings = collectWarnings({channel: 'sms', body: '{{design(palette.primary.main)}}', translations});
    expect(warnings).toContainEqual({
      severity: 'error',
      code: 'designNotAllowed',
      token: '{{design(palette.primary.main)}}',
    });
  });

  it('warns that a design token in the email body is not resolved in the preview', () => {
    const warnings = collectWarnings({channel: 'email', body: '{{design(palette.primary.main)}}', translations});
    expect(warnings).toEqual([
      {severity: 'warning', code: 'designPreviewUnsupported', token: '{{design(palette.primary.main)}}'},
    ]);
  });

  it('warns about a translation with no value for the locale', () => {
    const warnings = collectWarnings({channel: 'email', body: '{{t(missing.key)}}', translations});
    expect(warnings).toEqual([{severity: 'warning', code: 'missingTranslation', token: '{{t(missing.key)}}'}]);
  });

  it('does not warn about ctx tokens', () => {
    expect(collectWarnings({channel: 'email', body: '{{ctx(otp)}}', translations})).toEqual([]);
  });

  it('de-duplicates the same token+code across subject and body', () => {
    const warnings = collectWarnings({
      channel: 'email',
      subject: '{{meta(x)}}',
      body: '{{meta(x)}}',
      translations,
    });
    expect(warnings).toEqual([{severity: 'error', code: 'unsupported', token: '{{meta(x)}}'}]);
  });
});
