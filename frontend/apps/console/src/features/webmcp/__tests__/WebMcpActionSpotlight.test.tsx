// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {render, screen, waitFor} from '@thunderid/test-utils';
import {afterEach, describe, expect, it} from 'vitest';
import WebMcpActionSpotlight from '../components/WebMcpActionSpotlight';
import {announce, clearActivity} from '../store/webMcpActivityStore';

afterEach(() => {
  clearActivity();
});

describe('WebMcpActionSpotlight', () => {
  it('renders nothing when no tool is acting', () => {
    render(<WebMcpActionSpotlight />);

    expect(screen.queryByTestId('webmcp-action-chip')).toBeNull();
    expect(screen.queryByTestId('webmcp-action-ring')).toBeNull();
  });

  it('shows a status chip with the announced label', () => {
    announce({label: 'Opening Login Flows'});

    render(<WebMcpActionSpotlight />);

    expect(screen.getByTestId('webmcp-action-chip')).toHaveTextContent('Opening Login Flows');
  });

  it('draws a ring when the spotlight target is on screen', async () => {
    announce({label: 'Opening Login Flows', spotlightPath: '/flows'});

    render(
      <>
        <a href="/console/flows">Login Flows</a>
        <WebMcpActionSpotlight />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('webmcp-action-ring')).toBeInTheDocument();
    });
  });

  it('shows only the chip when the announcement has no spotlight target', () => {
    announce({label: 'Creating the application'});

    render(<WebMcpActionSpotlight />);

    expect(screen.getByTestId('webmcp-action-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('webmcp-action-ring')).toBeNull();
  });

  it('shows no ring when the target route is not rendered', async () => {
    announce({label: 'Opening Login Flows', spotlightPath: '/flows'});

    render(<WebMcpActionSpotlight />);

    // Give the tracking loop a chance to run and find nothing.
    await waitFor(() => {
      expect(screen.getByTestId('webmcp-action-chip')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('webmcp-action-ring')).toBeNull();
  });
});
