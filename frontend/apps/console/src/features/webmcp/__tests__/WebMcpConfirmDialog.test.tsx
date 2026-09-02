// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {render, screen, userEvent} from '@thunderid/test-utils';
import {describe, expect, it, vi} from 'vitest';
import WebMcpConfirmDialog from '../components/WebMcpConfirmDialog';
import type {ConfirmationRequest} from '../models/confirmation';

const request: ConfirmationRequest = {
  title: 'Create this application?',
  description: 'The wizard behind this dialog is filled in with the values below.',
  confirmLabel: 'Create application',
  details: [
    {label: 'Name', value: 'Storefront'},
    {label: 'Redirect URIs', value: 'https://app.example.com/callback'},
  ],
};

describe('WebMcpConfirmDialog', () => {
  it('stays closed with nothing pending', () => {
    render(<WebMcpConfirmDialog request={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByTestId('webmcp-confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows every value the tool is about to submit', () => {
    render(<WebMcpConfirmDialog request={request} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Create this application?')).toBeInTheDocument();
    expect(screen.getByText('Storefront')).toBeInTheDocument();
    expect(screen.getByText('https://app.example.com/callback')).toBeInTheDocument();
  });

  it('says the request came from an agent, so the admin knows what they are approving', () => {
    render(<WebMcpConfirmDialog request={request} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/requested by an AI agent/i)).toBeInTheDocument();
  });

  it('confirms and cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<WebMcpConfirmDialog request={request} onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByTestId('webmcp-confirm-accept'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('webmcp-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
