// Copyright 2025 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {
  Autocomplete,
  FormHelperText,
  FormLabel,
  Stack,
  TextField,
  Typography,
  type AutocompleteRenderInputParams,
} from '@wso2/oxygen-ui';
import {useMemo, type ReactNode, type SyntheticEvent} from 'react';
import {useTranslation} from 'react-i18next';
import type {CommonResourcePropertiesPropsInterface} from './types';
import useGetNotificationTemplates from '../../../../api/useGetNotificationTemplates';
import type {StepData} from '../../../../models/steps';

function EmailProperties({resource, onChange}: CommonResourcePropertiesPropsInterface): ReactNode {
  const {t} = useTranslation();
  const {data: templates, isLoading} = useGetNotificationTemplates('email');

  const properties = useMemo(() => {
    const stepData = resource?.data as StepData | undefined;
    return stepData?.properties ?? {};
  }, [resource]);

  const emailTemplate = (properties['emailTemplate'] as string) || '';

  // Keep the current value selectable even when it is not one the server returned, so a flow
  // authored elsewhere is not silently blanked.
  const options = useMemo((): string[] => {
    const handles = (templates ?? []).map((template) => template.handle);
    return emailTemplate && !handles.includes(emailTemplate) ? [...handles, emailTemplate] : handles;
  }, [templates, emailTemplate]);

  const labelByHandle = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {};
    (templates ?? []).forEach((template) => {
      map[template.handle] = template.displayName;
    });
    return map;
  }, [templates]);

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        {t('flows:core.executions.email.description')}
      </Typography>

      <div>
        <FormLabel htmlFor="email-template">{t('flows:core.executions.email.emailTemplate.label')}</FormLabel>
        <Autocomplete
          id="email-template"
          options={options}
          value={emailTemplate || null}
          loading={isLoading}
          getOptionLabel={(option: string) => labelByHandle[option] ?? option}
          onChange={(_event: SyntheticEvent, newValue: string | null) =>
            onChange('data.properties.emailTemplate', newValue ?? '', resource)
          }
          renderInput={(params: AutocompleteRenderInputParams) => (
            <TextField
              {...params}
              placeholder={t('flows:core.executions.email.emailTemplate.placeholder', 'Select an email template')}
              size="small"
            />
          )}
          fullWidth
          size="small"
        />
        <FormHelperText>{t('flows:core.executions.email.emailTemplate.hint')}</FormHelperText>
      </div>
    </Stack>
  );
}

export default EmailProperties;
