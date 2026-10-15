// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package tokens

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

var theme = json.RawMessage(`{
	"defaultColorScheme": "light",
	"colorSchemes": {
		"light": {"palette": {"primary": {"main": "#fff"}}},
		"dark":  {
			"palette": {"primary": {"main": "#111"}, "contrast": 4.5},
			"dense": true,
			"radius": 1.0,
			"fontFamily": ["Inter", "Helvetica", "sans-serif"]
		}
	}
}`)

func TestSubstitute(t *testing.T) {
	// Explicit scheme, dot-path token.
	require.Equal(t, "color:#111",
		Substitute("color:{{design(palette.primary.main)}}", theme, "dark", false))

	// Numeric leaf preserves authored form.
	require.Equal(t, "4.5", Substitute("{{design(palette.contrast)}}", theme, "dark", false))

	// Integer-valued float keeps its authored ".0" (json.Number, no float coercion).
	require.Equal(t, "1.0", Substitute("{{design(radius)}}", theme, "dark", false))

	// Boolean leaf.
	require.Equal(t, "true", Substitute("{{design(dense)}}", theme, "dark", false))

	// Array of scalars joined with ", ".
	require.Equal(t, "Inter, Helvetica, sans-serif",
		Substitute("{{design(fontFamily)}}", theme, "dark", false))

	// Empty scheme falls back to defaultColorScheme.
	require.Equal(t, "#fff", Substitute("{{design(palette.primary.main)}}", theme, "", false))

	// Multiple placeholders in one string.
	require.Equal(t, "#111/4.5",
		Substitute("{{design(palette.primary.main)}}/{{design(palette.contrast)}}", theme, "dark", false))

	// Unknown token left literal.
	require.Equal(t, "{{design(palette.secondary.main)}}",
		Substitute("{{design(palette.secondary.main)}}", theme, "dark", false))

	// HTML escaping of the substituted value when requested.
	quoteTheme := json.RawMessage(`{"colorSchemes":{"dark":{"label":"a<b"}}}`)
	require.Equal(t, "a&lt;b", Substitute("{{design(label)}}", quoteTheme, "dark", true))
	// ...and NOT escaped when escapeHTML is false.
	require.Equal(t, "a<b", Substitute("{{design(label)}}", quoteTheme, "dark", false))
}

func TestSubstitute_Degrades(t *testing.T) {
	// No placeholders: unchanged (fast path, no parse).
	require.Equal(t, "plain", Substitute("plain", theme, "dark", false))
	// Empty theme: content unchanged.
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", nil, "dark", false))
	// Bad JSON: content unchanged.
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", json.RawMessage(`nope`), "dark", false))
	// Unknown scheme: content unchanged.
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", theme, "neon", false))
	// Null and non-scalar-only leaves are skipped (left literal).
	nullTheme := json.RawMessage(`{"colorSchemes":{"dark":{"x":null}}}`)
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", nullTheme, "dark", false))
}
