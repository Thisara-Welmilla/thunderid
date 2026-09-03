// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, Paper, Typography, keyframes} from '@wso2/oxygen-ui';
import {useEffect, useState, useSyncExternalStore, type JSX} from 'react';
import {useTranslation} from 'react-i18next';
import {getSnapshot, subscribe} from '../store/webMcpActivityStore';
import findNavAnchor from '../utils/findNavAnchor';

/**
 * Padding, in pixels, between the highlighted element and the ring drawn around it, so the ring reads
 * as framing the target rather than clipping it.
 *
 * @internal
 */
const RING_PADDING = 6;

/**
 * The spotlight accent, as an `r, g, b` triple so it can be dropped into `rgba(...)` at any opacity.
 * Amber (#FFB300), chosen to stand out against the console's blue chrome. Change it here and the
 * ring, its pulse, and the chip's dot all follow.
 *
 * @internal
 */
const ACCENT_RGB = '255, 179, 0';

const pulseRing = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(${ACCENT_RGB}, 0.55); }
  70% { box-shadow: 0 0 0 10px rgba(${ACCENT_RGB}, 0); }
  100% { box-shadow: 0 0 0 0 rgba(${ACCENT_RGB}, 0); }
`;

const pulseDot = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
`;

const dotBlink = keyframes`
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
`;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Shows where the WebMCP tools are acting: a status chip that narrates the current action, and a
 * pulsing ring around the element it targets (the sidebar item it is navigating to).
 *
 * Mounted by `WebMcpJourney`, so it only exists in a WebMCP-capable browser and adds nothing to the
 * console otherwise. It is purely presentational and never intercepts input: both the chip and the
 * ring set `pointer-events: none`, and the chip dismisses itself, so it can never sit in front of a
 * control the admin needs to click.
 *
 * @returns The chip and ring, or nothing when no tool is currently acting
 */
export default function WebMcpActionSpotlight(): JSX.Element | null {
  const {t} = useTranslation();
  const activity = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [rect, setRect] = useState<TargetRect | null>(null);

  const activityId = activity?.id;
  const spotlightPath = activity?.spotlightPath;

  useEffect(() => {
    if (spotlightPath === undefined) {
      setRect(null);
      return undefined;
    }

    const measure = (): void => {
      const target = findNavAnchor(spotlightPath);
      if (target) {
        const box = target.getBoundingClientRect();
        setRect({top: box.top, left: box.left, width: box.width, height: box.height});
      } else {
        setRect(null);
      }
    };

    // Measure once synchronously so the ring appears immediately, then keep it pinned to the element
    // as the page scrolls or reflows. `requestAnimationFrame` is feature-detected: without it (some
    // test environments) the single measurement above still positions the ring.
    measure();

    if (typeof requestAnimationFrame !== 'function') {
      return undefined;
    }

    let frame = requestAnimationFrame(function track() {
      measure();
      frame = requestAnimationFrame(track);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
    // activityId re-arms tracking when a repeated navigation reuses the same path.
  }, [activityId, spotlightPath]);

  if (!activity) {
    return null;
  }

  return (
    <>
      {rect && (
        <Box
          data-testid="webmcp-action-ring"
          aria-hidden
          sx={{
            position: 'fixed',
            top: rect.top - RING_PADDING,
            left: rect.left - RING_PADDING,
            width: rect.width + RING_PADDING * 2,
            height: rect.height + RING_PADDING * 2,
            border: `2px solid rgba(${ACCENT_RGB}, 0.9)`,
            borderRadius: 2,
            pointerEvents: 'none',
            animation: `${pulseRing} 1.4s ease-out infinite`,
            zIndex: (theme) => theme.zIndex.tooltip + 1,
          }}
        />
      )}
      <Paper
        elevation={6}
        role="status"
        aria-live="polite"
        data-testid="webmcp-action-chip"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
          borderRadius: 6,
          pointerEvents: 'none',
          zIndex: (theme) => theme.zIndex.tooltip + 2,
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: `rgba(${ACCENT_RGB}, 1)`,
            animation: `${pulseDot} 1.2s ease-in-out infinite`,
          }}
        />
        <Box component="span" aria-hidden sx={{fontSize: 16, lineHeight: 1}}>
          {'\u{1F916}'}
        </Box>
        <Typography variant="body2" sx={{fontWeight: 500}}>
          {activity.thinking ? (
            <>
              {t('common:webmcp.spotlight.thinking', 'Thinking about the next step')}
              <Box component="span" aria-hidden sx={{ml: 0.25}}>
                {[0, 1, 2].map((index) => (
                  <Box
                    key={index}
                    component="span"
                    sx={{animation: `${dotBlink} 1.2s ${index * 0.2}s ease-in-out infinite`}}
                  >
                    .
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            activity.label
          )}
        </Typography>
      </Paper>
    </>
  );
}
