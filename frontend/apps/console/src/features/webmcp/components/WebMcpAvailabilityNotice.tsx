// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {Alert, AlertTitle} from '@wso2/oxygen-ui';
import {useMemo, type JSX} from 'react';
import {useTranslation} from 'react-i18next';
import getModelContext from '../utils/getModelContext';

/**
 * Points out, on the static walkthrough, that this browser can drive the same journey through an AI
 * agent instead.
 *
 * Renders nothing when `document.modelContext` / `navigator.modelContext` is absent, which is what
 * makes the static page the fallback: in a browser without WebMCP the page is byte-for-byte what it
 * is today, and only a WebMCP-capable Chrome learns that the guided route exists.
 *
 * @returns The notice, or nothing when WebMCP is unavailable
 */
export default function WebMcpAvailabilityNotice(): JSX.Element | null {
  const {t} = useTranslation();
  const isAvailable = useMemo(() => getModelContext() !== null, []);

  if (!isAvailable) {
    return null;
  }

  return (
    <Alert severity="info" sx={{mb: 4, textAlign: 'left'}} data-testid="webmcp-availability-notice">
      <AlertTitle>{t('common:webmcp.notice.title', 'Your browser can walk you through this')}</AlertTitle>
      {t(
        'common:webmcp.notice.description',
        'An AI agent in this tab can set up single sign-on for your application by driving this console: ' +
          'creating the application, configuring its login flow, and starting a test sign-in. Every change is ' +
          'shown to you for confirmation first. Ask it to set up SSO for your app, or follow the steps below ' +
          'yourself.',
      )}
    </Alert>
  );
}
