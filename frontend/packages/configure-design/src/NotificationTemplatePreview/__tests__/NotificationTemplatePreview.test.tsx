// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {render, screen} from '@thunderid/test-utils';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import NotificationTemplatePreview from '../NotificationTemplatePreview';

interface UseGetTranslationsResult {
  data: {translations: Record<string, Record<string, string>>} | undefined;
}

const {mockUseGetTranslations} = vi.hoisted(() => ({
  mockUseGetTranslations: vi.fn<() => UseGetTranslationsResult>(),
}));

vi.mock('@thunderid/i18n', () => ({
  useGetTranslations: () => mockUseGetTranslations(),
}));

vi.mock('@thunderid/design', () => ({
  DefaultTheme: {palette: {primary: {main: '#3688ff'}}},
}));

// Stub the themed iframe; expose the resolved mock components it is handed.
vi.mock('../../GatePreview/GatePreview', () => ({
  default: ({mock}: {mock?: {label?: string}[]}) => (
    <div data-testid="gate-preview" data-mock={JSON.stringify(mock)} />
  ),
}));

function setTranslations(notification: Record<string, string> = {}): void {
  mockUseGetTranslations.mockReturnValue({data: {translations: {notification}}});
}

describe('NotificationTemplatePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTranslations();
  });

  it('renders the themed preview surface', () => {
    render(<NotificationTemplatePreview channel="email" subject="Hi" body="<p>Body</p>" locale="en-US" />);

    expect(screen.getByTestId('gate-preview')).toBeInTheDocument();
  });

  it('resolves {{t(key)}} against the selected locale and leaves {{ctx}} literal', () => {
    setTranslations({'otp.subject': 'Your verification code'});

    render(
      <NotificationTemplatePreview
        channel="email"
        subject="{{t(otp.subject)}}"
        body="<p>{{ctx(otp)}}</p>"
        locale="en-US"
      />,
    );

    const mock = screen.getByTestId('gate-preview').getAttribute('data-mock') ?? '';
    expect(mock).toContain('Your verification code');
    expect(mock).toContain('{{ctx(otp)}}');
  });

  it('shows no warnings for supported, resolvable tokens', () => {
    setTranslations({'otp.subject': 'Your verification code'});

    render(
      <NotificationTemplatePreview
        channel="email"
        subject="{{t(otp.subject)}}"
        body="<p>{{ctx(otp)}}</p>"
        locale="en-US"
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns about an unsupported token', () => {
    render(<NotificationTemplatePreview channel="email" body="{{meta(application.name)}}" locale="en-US" />);

    expect(screen.getByText(/is not a supported token/i)).toBeInTheDocument();
  });

  it('warns when a design token is used in the subject', () => {
    render(
      <NotificationTemplatePreview
        channel="email"
        subject="{{design(palette.primary.main)}}"
        body="hi"
        locale="en-US"
      />,
    );

    expect(screen.getByText(/only allowed in the email body/i)).toBeInTheDocument();
  });

  it('warns when a translation has no value for the locale', () => {
    render(<NotificationTemplatePreview channel="email" body="{{t(missing.key)}}" locale="en-US" />);

    expect(screen.getByText(/No translation for/i)).toBeInTheDocument();
  });

  it('renders only a body for the SMS channel', () => {
    render(<NotificationTemplatePreview channel="sms" body="Your code is {{ctx(otp)}}" locale="en-US" />);

    const mock = screen.getByTestId('gate-preview').getAttribute('data-mock') ?? '';
    expect(mock).toContain('Your code is {{ctx(otp)}}');
    expect(mock).not.toContain('notification-subject');
  });
});
