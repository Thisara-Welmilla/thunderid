// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {renderHook, waitFor} from '@thunderid/test-utils';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {NotificationTemplateListResponse, NotificationTemplateSummary} from '../../models/notification-templates';
import useGetNotificationTemplates from '../useGetNotificationTemplates';

const mockGetServerUrl = vi.fn(() => 'https://api.example.com');

vi.mock('@thunderid/contexts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@thunderid/contexts')>();
  return {
    ...actual,
    useConfig: () => ({
      getServerUrl: mockGetServerUrl,
    }),
  };
});

const mockHttpRequest = vi.fn();

vi.mock('@thunderid/react', () => ({
  useThunderID: () => ({
    http: {
      request: mockHttpRequest,
    },
  }),
}));

/** Builds a list envelope response for the mock HTTP client. */
const listResponse = (templates: NotificationTemplateSummary[]): {data: NotificationTemplateListResponse} => ({
  data: {totalResults: templates.length, startIndex: 1, count: templates.length, templates},
});

describe('useGetNotificationTemplates', () => {
  const mockTemplates: NotificationTemplateSummary[] = [
    {
      id: 'id-1',
      handle: 'user-invite',
      displayName: 'User Invite',
      self: '/notification-templates/email/templates/id-1',
    },
    {
      id: 'id-2',
      handle: 'password-recovery',
      displayName: 'Password Recovery',
      self: '/notification-templates/email/templates/id-2',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should request the channel template collection', async () => {
    mockHttpRequest.mockResolvedValueOnce(listResponse(mockTemplates));

    const {result} = renderHook(() => useGetNotificationTemplates('email'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockHttpRequest).toHaveBeenCalledWith({
      url: 'https://api.example.com/notification-templates/email/templates?limit=100',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('should request the sms channel when asked', async () => {
    mockHttpRequest.mockResolvedValueOnce(listResponse([]));

    const {result} = renderHook(() => useGetNotificationTemplates('sms'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/notification-templates/sms/templates?limit=100',
      }),
    );
  });

  it('should return the unwrapped templates array on success', async () => {
    mockHttpRequest.mockResolvedValueOnce(listResponse(mockTemplates));

    const {result} = renderHook(() => useGetNotificationTemplates('email'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockTemplates);
  });

  it('should be loading initially', () => {
    mockHttpRequest.mockImplementation(() => new Promise(() => null));

    const {result} = renderHook(() => useGetNotificationTemplates('email'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('should handle errors', async () => {
    mockHttpRequest.mockRejectedValueOnce(new Error('Network error'));

    const {result} = renderHook(() => useGetNotificationTemplates('email'));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });
});
