// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, describe, expect, it} from 'vitest';
import getModelContext from '../utils/getModelContext';

function setModelContext(target: Document | Navigator, value: unknown): void {
  Object.defineProperty(target, 'modelContext', {value, configurable: true, writable: true});
}

function clearModelContext(): void {
  Reflect.deleteProperty(document, 'modelContext');
  Reflect.deleteProperty(navigator, 'modelContext');
}

afterEach(() => {
  clearModelContext();
});

describe('getModelContext', () => {
  it('returns null when WebMCP is absent', () => {
    expect(getModelContext()).toBeNull();
  });

  it('returns the document-scoped context', () => {
    const context = {registerTool: () => undefined};
    setModelContext(document, context);

    expect(getModelContext()).toBe(context);
  });

  it('falls back to the navigator-scoped context', () => {
    const context = {registerTool: () => undefined};
    setModelContext(navigator, context);

    expect(getModelContext()).toBe(context);
  });

  it('prefers the document-scoped context over the navigator-scoped one', () => {
    const documentContext = {registerTool: () => undefined};
    const navigatorContext = {registerTool: () => undefined};
    setModelContext(document, documentContext);
    setModelContext(navigator, navigatorContext);

    expect(getModelContext()).toBe(documentContext);
  });

  it('accepts a context that exposes only provideContext', () => {
    const context = {provideContext: () => undefined};
    setModelContext(navigator, context);

    expect(getModelContext()).toBe(context);
  });

  it('returns null when the context can neither register nor provide tools', () => {
    setModelContext(document, {});

    expect(getModelContext()).toBeNull();
  });
});
