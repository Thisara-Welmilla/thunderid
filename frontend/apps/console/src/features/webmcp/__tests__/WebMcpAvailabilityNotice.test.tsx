// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {render, screen} from '@thunderid/test-utils';
import {afterEach, describe, expect, it} from 'vitest';
import WebMcpAvailabilityNotice from '../components/WebMcpAvailabilityNotice';

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext');
});

describe('WebMcpAvailabilityNotice', () => {
  it('renders nothing without WebMCP, leaving the static walkthrough as it is today', () => {
    const {container} = render(<WebMcpAvailabilityNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('tells the admin the guided route exists when WebMCP is available', () => {
    Object.defineProperty(document, 'modelContext', {
      value: {registerTool: () => undefined},
      configurable: true,
      writable: true,
    });

    render(<WebMcpAvailabilityNotice />);

    expect(screen.getByTestId('webmcp-availability-notice')).toBeInTheDocument();
    expect(screen.getByText(/walk you through this/i)).toBeInTheDocument();
  });
});
