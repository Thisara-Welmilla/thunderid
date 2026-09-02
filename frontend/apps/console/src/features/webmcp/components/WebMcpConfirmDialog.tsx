// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@wso2/oxygen-ui';
import type {JSX} from 'react';
import {useTranslation} from 'react-i18next';
import type {ConfirmationRequest} from '../models/confirmation';

/**
 * Props for the {@link WebMcpConfirmDialog} component.
 */
export interface WebMcpConfirmDialogProps {
  /**
   * The pending confirmation, or `null` when no mutating tool is waiting.
   */
  request: ConfirmationRequest | null;
  /**
   * Called when the admin approves the write.
   */
  onConfirm: () => void;
  /**
   * Called when the admin declines, or dismisses the dialog.
   */
  onCancel: () => void;
}

/**
 * Confirmation shown before any WebMCP tool writes to the deployment.
 *
 * No mutating tool executes without this: it renders the exact payload the tool is about to submit
 * (application name, organization unit, redirect URIs, grant types) so the admin approves what the
 * console will actually do, not the agent's paraphrase of it.
 *
 * @param props - Component props
 * @returns The dialog, or nothing when no tool is waiting
 */
export default function WebMcpConfirmDialog({request, onConfirm, onCancel}: WebMcpConfirmDialogProps): JSX.Element {
  const {t} = useTranslation();

  return (
    <Dialog open={request !== null} onClose={onCancel} maxWidth="sm" fullWidth data-testid="webmcp-confirm-dialog">
      <DialogTitle>{request?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{mb: 2}}>{request?.description}</DialogContentText>
        <Stack spacing={1.5}>
          {(request?.details ?? []).map((detail) => (
            <Stack key={detail.label} spacing={0.25}>
              <Typography variant="caption" color="text.secondary">
                {detail.label}
              </Typography>
              <Typography variant="body2" sx={{overflowWrap: 'anywhere'}}>
                {detail.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Alert severity="info" sx={{mt: 3}}>
          {t(
            'common:webmcp.confirm.provenance',
            'This was requested by an AI agent running in this browser tab. Nothing is saved until you confirm.',
          )}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} data-testid="webmcp-confirm-cancel">
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button onClick={onConfirm} variant="contained" data-testid="webmcp-confirm-accept">
          {request?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
