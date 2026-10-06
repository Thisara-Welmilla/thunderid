// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {useConfig} from '@thunderid/contexts';
import {useThunderID} from '@thunderid/react';
import FlowQueryKeys from '../constants/flow-query-keys';
import type {
  NotificationTemplateChannel,
  NotificationTemplateListResponse,
  NotificationTemplateSummary,
} from '../models/notification-templates';

// Server-side max page size; the picker requests a single full page of this size (see
// MaxPageSize in backend/internal/system/constants). A deployment exceeding this per channel
// would need true pagination added here.
const TEMPLATE_PAGE_SIZE = 100;

/**
 * Fetches the notification templates of a channel, used to populate the Email/SMS executor
 * template pickers. Backed by GET /notification-templates/{channel}/templates, requesting a
 * single max-size page.
 *
 * @param channel - The template channel to list (email or sms).
 * @returns TanStack Query result with the channel's template summaries.
 *
 * @example
 * ```tsx
 * const {data, isLoading} = useGetNotificationTemplates('email');
 * ```
 */
export default function useGetNotificationTemplates(
  channel: NotificationTemplateChannel,
): UseQueryResult<NotificationTemplateSummary[]> {
  const {http} = useThunderID();
  const {getServerUrl} = useConfig();

  return useQuery<NotificationTemplateSummary[]>({
    queryKey: [FlowQueryKeys.NOTIFICATION_TEMPLATES, channel],
    queryFn: async (): Promise<NotificationTemplateSummary[]> => {
      const serverUrl: string = getServerUrl();

      const response: {
        data: NotificationTemplateListResponse;
      } = await http.request({
        url: `${serverUrl}/notification-templates/${channel}/templates?limit=${TEMPLATE_PAGE_SIZE}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      } as unknown as Parameters<typeof http.request>[0]);

      return response.data.templates;
    },
  });
}
