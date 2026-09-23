// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Notification-template token grammar, mirroring the backend
// (internal/notificationtemplate/placeholder.go): only {{t(key)}}, {{design(key)}}, {{ctx(key)}},
// no inner spaces, key = [A-Za-z0-9_.-]+; design is email-body only.

export type NotificationChannel = 'email' | 'sms';
export type TemplateField = 'subject' | 'body';
export type TokenKind = 't' | 'design' | 'ctx';

/** A parsed {{...}} block; `kind: null` means malformed/unsupported. */
export interface ParsedToken {
  raw: string;
  kind: TokenKind | null;
  key?: string;
}

/** A token the preview cannot render faithfully. */
export interface TemplateWarning {
  severity: 'error' | 'warning';
  code: 'unsupported' | 'designNotAllowed' | 'designPreviewUnsupported' | 'missingTranslation';
  token: string;
}

const TOKEN_BLOCK_REGEX = /\{\{([\s\S]*?)\}\}/g;
const VALID_PLACEHOLDER_REGEX = /^(ctx|t|design)\(([A-Za-z0-9_.-]+)\)$/;

/** Parses and classifies every {{...}} block in `text`. */
export function parseTokens(text: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  for (const match of text.matchAll(TOKEN_BLOCK_REGEX)) {
    const raw = match[0];
    const inner = match[1];
    const parts = VALID_PLACEHOLDER_REGEX.exec(inner);
    if (parts) {
      tokens.push({raw, kind: parts[1] as TokenKind, key: parts[2]});
    } else {
      tokens.push({raw, kind: null});
    }
  }
  return tokens;
}

/** Substitutes {{t(key)}} with its translation (left literal when absent); leaves everything else. */
export function resolveForPreview(text: string | undefined, translations: Record<string, string>): string {
  if (!text) {
    return '';
  }
  return text.replace(TOKEN_BLOCK_REGEX, (raw, inner: string) => {
    const parts = VALID_PLACEHOLDER_REGEX.exec(inner);
    if (parts && parts[1] === 't') {
      const value = translations[parts[2]];
      return value ?? raw;
    }
    return raw;
  });
}

/** Collects warnings for one field. */
function collectFieldWarnings(
  text: string | undefined,
  field: TemplateField,
  channel: NotificationChannel,
  translations: Record<string, string>,
): TemplateWarning[] {
  if (!text) {
    return [];
  }
  const warnings: TemplateWarning[] = [];
  for (const token of parseTokens(text)) {
    if (token.kind === null) {
      warnings.push({severity: 'error', code: 'unsupported', token: token.raw});
      continue;
    }
    if (token.kind === 'design') {
      if (field === 'subject' || channel === 'sms') {
        warnings.push({severity: 'error', code: 'designNotAllowed', token: token.raw});
      } else {
        warnings.push({severity: 'warning', code: 'designPreviewUnsupported', token: token.raw});
      }
      continue;
    }
    if (token.kind === 't' && token.key !== undefined && translations[token.key] === undefined) {
      warnings.push({severity: 'warning', code: 'missingTranslation', token: token.raw});
    }
    // ctx is the expected runtime case — left literal, not warned.
  }
  return warnings;
}

/** De-duplicated warnings across subject and body. */
export function collectWarnings(input: {
  subject?: string;
  body: string;
  channel: NotificationChannel;
  translations: Record<string, string>;
}): TemplateWarning[] {
  const all = [
    ...collectFieldWarnings(input.subject, 'subject', input.channel, input.translations),
    ...collectFieldWarnings(input.body, 'body', input.channel, input.translations),
  ];
  const seen = new Set<string>();
  const deduped: TemplateWarning[] = [];
  for (const warning of all) {
    const dedupeKey = `${warning.code}:${warning.token}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(warning);
  }
  return deduped;
}
