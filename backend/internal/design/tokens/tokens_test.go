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
		"dark":  {"palette": {"primary": {"main": "#111"}, "contrast": 4.5}}
	}
}`)

func TestSubstitute(t *testing.T) {
	// Explicit scheme, dot-path token.
	require.Equal(t, "color:#111",
		Substitute("color:{{design(palette.primary.main)}}", theme, "dark", false))

	// Numeric leaf.
	require.Equal(t, "4.5", Substitute("{{design(palette.contrast)}}", theme, "dark", false))

	// Empty scheme falls back to defaultColorScheme.
	require.Equal(t, "#fff", Substitute("{{design(palette.primary.main)}}", theme, "", false))

	// Unknown token left literal.
	require.Equal(t, "{{design(palette.secondary.main)}}",
		Substitute("{{design(palette.secondary.main)}}", theme, "dark", false))

	// HTML escaping of the substituted value.
	quoteTheme := json.RawMessage(`{"colorSchemes":{"dark":{"label":"a<b"}}}`)
	require.Equal(t, "a&lt;b", Substitute("{{design(label)}}", quoteTheme, "dark", true))
}

func TestSubstitute_Degrades(t *testing.T) {
	// Empty theme: content unchanged.
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", nil, "dark", false))
	// Bad JSON: content unchanged.
	require.Equal(t, "{{design(x)}}", Substitute("{{design(x)}}", json.RawMessage(`nope`), "dark", false))
	// No placeholders: unchanged.
	require.Equal(t, "plain", Substitute("plain", theme, "dark", false))
}
