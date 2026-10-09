// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {NotificationChannel} from '../models/notification-template';

/**
 * General notification-template constants.
 */
const NotificationTemplateConstants = {
  /**
   * Fallback avatar rendered for a template row when no icon is resolved.
   */
  DEFAULT_AVATAR: 'emoji:✉️',
  /**
   * The channels a template can belong to, in display order.
   */
  CHANNELS: ['email', 'sms'] as const satisfies readonly NotificationChannel[],
  /**
   * Default channel shown when the list page first opens.
   */
  DEFAULT_CHANNEL: 'email' as NotificationChannel,
} as const;

export default NotificationTemplateConstants;
