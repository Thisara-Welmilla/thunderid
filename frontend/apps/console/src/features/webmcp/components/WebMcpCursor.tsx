// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {Box, keyframes} from '@wso2/oxygen-ui';
import {useEffect, useState, useSyncExternalStore, type JSX} from 'react';
import {getSnapshot, subscribe} from '../store/webMcpCursorStore';

const ACCENT = 'rgba(255, 179, 0, 1)';
const ACCENT_RGB = '255, 179, 0';
const RING_PADDING = 6;

const clickPulse = keyframes`
  0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0.9; }
  100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
`;

const targetPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(${ACCENT_RGB}, 0.55); }
  70% { box-shadow: 0 0 0 10px rgba(${ACCENT_RGB}, 0); }
  100% { box-shadow: 0 0 0 0 rgba(${ACCENT_RGB}, 0); }
`;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Draws the fake pointer the WebMCP tools glide to their targets, plus a click pulse. Purely
 * cosmetic and non-interactive (`pointer-events: none`), so it never blocks or triggers anything; it
 * only shows where the agent is acting. Renders nothing unless a tool has made it visible, so it
 * costs nothing at the default `off` speed.
 *
 * @returns The pointer and its click pulse, or nothing when hidden
 */
export default function WebMcpCursor(): JSX.Element | null {
  const cursor = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [ringRect, setRingRect] = useState<Rect | null>(null);

  const targetEl = cursor.targetEl;

  useEffect(() => {
    if (!targetEl) {
      setRingRect(null);
      return undefined;
    }

    // Returns false once the target leaves the DOM (e.g. the confirm dialog closed), which stops the
    // loop and drops the ring rather than leaving it pinned to a detached node.
    const measure = (): boolean => {
      if (!targetEl.isConnected) {
        setRingRect(null);
        return false;
      }
      const box = targetEl.getBoundingClientRect();
      setRingRect({top: box.top, left: box.left, width: box.width, height: box.height});
      return true;
    };

    if (!measure() || typeof requestAnimationFrame !== 'function') {
      return undefined;
    }

    let frame = requestAnimationFrame(function track() {
      if (measure()) {
        frame = requestAnimationFrame(track);
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [targetEl]);

  if (!cursor.visible) {
    return null;
  }

  return (
    <>
      {ringRect && (
        <Box
          aria-hidden
          data-testid="webmcp-cursor-ring"
          sx={{
            position: 'fixed',
            top: ringRect.top - RING_PADDING,
            left: ringRect.left - RING_PADDING,
            width: ringRect.width + RING_PADDING * 2,
            height: ringRect.height + RING_PADDING * 2,
            border: `2px solid rgba(${ACCENT_RGB}, 0.9)`,
            borderRadius: 2,
            pointerEvents: 'none',
            animation: `${targetPulse} 1.4s ease-out infinite`,
            zIndex: (theme) => theme.zIndex.tooltip + 3,
          }}
        />
      )}
      {cursor.clicking && (
        <Box
          aria-hidden
          data-testid="webmcp-cursor-pulse"
          sx={{
            position: 'fixed',
            top: cursor.y,
            left: cursor.x,
            width: 26,
            height: 26,
            borderRadius: '50%',
            border: `2px solid ${ACCENT}`,
            pointerEvents: 'none',
            animation: `${clickPulse} 260ms ease-out forwards`,
            zIndex: (theme) => theme.zIndex.tooltip + 4,
          }}
        />
      )}
      <Box
        aria-hidden
        data-testid="webmcp-cursor"
        sx={{
          position: 'fixed',
          top: cursor.y,
          left: cursor.x,
          transform: 'translate(-2px, -2px)',
          transition: cursor.moveMs > 0 ? `top ${cursor.moveMs}ms ease-in-out, left ${cursor.moveMs}ms ease-in-out` : 'none',
          pointerEvents: 'none',
          zIndex: (theme) => theme.zIndex.tooltip + 5,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
          lineHeight: 0,
        }}
      >
        {/* A simple pointer arrow, tip at the top-left so it lines up with the fixed coordinate. */}
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M2 2 L2 16 L6.2 12.2 L9 18.4 L11.4 17.3 L8.7 11.2 L14 11 Z"
            fill={ACCENT}
            stroke="rgba(0,0,0,0.55)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      </Box>
    </>
  );
}
