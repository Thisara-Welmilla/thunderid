// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {DefaultTheme, type Theme} from '@thunderid/design';
import {useGetTranslations} from '@thunderid/i18n';
import type {EmbeddedFlowComponent} from '@thunderid/react';
import {Alert, Box, Stack} from '@wso2/oxygen-ui';
import {useMemo, type JSX} from 'react';
import {useTranslation} from 'react-i18next';
import GatePreview from '../GatePreview/GatePreview';
import {
  collectWarnings,
  resolveForPreview,
  type NotificationChannel,
  type TemplateWarning,
} from './templateTokens';

export type {NotificationChannel} from './templateTokens';

// Namespace {{t(key)}} tokens resolve under (fixed, matches the backend).
const NOTIFICATION_NAMESPACE = 'notification';

export interface NotificationTemplatePreviewProps {
  channel: NotificationChannel;
  /** Raw subject (email only), placeholders intact. */
  subject?: string;
  /** Raw body — HTML (email) or text (SMS), placeholders intact. */
  body: string;
  /** Locale resolving {{t(key)}}; unset → not resolved. */
  locale?: string;
  /** Resolved theme (caller-provided). `undefined` → default theme; `null` → spinner. */
  theme?: Theme | null;
  colorScheme?: 'light' | 'dark';
}

/**
 * Presentational live preview of a notification template (email/SMS) for a given locale,
 * theme and color scheme, rendered via GatePreview. Resolves {{t(key)}}; leaves {{ctx}}
 * and {{design}} literal; warns on tokens that won't render (see `collectWarnings`).
 * Reused by the flow step preview and the template editor.
 */
export default function NotificationTemplatePreview({
  channel,
  subject = undefined,
  body,
  locale = undefined,
  theme = undefined,
  colorScheme = undefined,
}: NotificationTemplatePreviewProps): JSX.Element {
  const {t} = useTranslation('design');

  // Translations for the selected locale, notification namespace; disabled until a locale is set.
  const {data: translationsData} = useGetTranslations({
    language: locale ?? '',
    namespace: NOTIFICATION_NAMESPACE,
    enabled: Boolean(locale),
  });
  const translations = useMemo(
    () => translationsData?.translations?.[NOTIFICATION_NAMESPACE] ?? {},
    [translationsData],
  );

  const warnings = useMemo(
    () => collectWarnings({subject, body, channel, translations}),
    [subject, body, channel, translations],
  );

  const mock: EmbeddedFlowComponent[] = useMemo(() => {
    const components: EmbeddedFlowComponent[] = [];
    if (channel === 'email' && subject) {
      components.push({
        id: 'notification-subject',
        type: 'TEXT',
        label: resolveForPreview(subject, translations),
      } as unknown as EmbeddedFlowComponent);
    }
    components.push({
      id: 'notification-body',
      // Email bodies are HTML (RICH_TEXT); SMS bodies are plain text (TEXT).
      type: channel === 'email' ? 'RICH_TEXT' : 'TEXT',
      label: resolveForPreview(body, translations),
    } as unknown as EmbeddedFlowComponent);
    return components;
  }, [channel, subject, body, translations]);

  return (
    <Stack spacing={1.5} sx={{width: '100%'}}>
      {warnings.length > 0 && (
        <Stack spacing={1}>
          {warnings.map((warning) => (
            <Alert key={`${warning.code}:${warning.token}`} severity={warning.severity} sx={{py: 0.25}}>
              {warningMessage(t, warning)}
            </Alert>
          ))}
        </Stack>
      )}

      {/* Floating card; GatePreview is frameless and contributes only the themed content. */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          width: '100%',
          p: 2,
          boxSizing: 'border-box',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: channel === 'sms' ? 360 : 640,
            minHeight: channel === 'sms' ? 560 : 420,
            borderRadius: 2,
            boxShadow: 8,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
        >
          <GatePreview
            frameless
            theme={theme === undefined ? (DefaultTheme as Theme) : theme}
            baseTheme={DefaultTheme as Theme}
            mock={mock}
            colorScheme={colorScheme}
            showToolbar={false}
          />
        </Box>
      </Box>
    </Stack>
  );
}

/** Maps a warning code to a localized message. */
function warningMessage(
  t: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
  warning: TemplateWarning,
): string {
  const {code, token} = warning;
  switch (code) {
    case 'unsupported':
      return t(
        'notificationTemplatePreview.warnings.unsupported',
        '"{{token}}" is not a supported token and will cause the template to fail to send.',
        {token},
      );
    case 'designNotAllowed':
      return t(
        'notificationTemplatePreview.warnings.designNotAllowed',
        'Design token "{{token}}" is only allowed in the email body, not here.',
        {token},
      );
    case 'designPreviewUnsupported':
      return t(
        'notificationTemplatePreview.warnings.designPreviewUnsupported',
        'Design token "{{token}}" is resolved from the theme when sent; it is shown as-is in this preview.',
        {token},
      );
    case 'missingTranslation':
      return t(
        'notificationTemplatePreview.warnings.missingTranslation',
        'No translation for "{{token}}" in the selected language; it is shown as-is and may not render.',
        {token},
      );
    default:
      return token;
  }
}
