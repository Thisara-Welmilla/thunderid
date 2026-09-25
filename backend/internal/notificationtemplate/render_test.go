// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSubstituteCtx(t *testing.T) {
	data := map[string]string{"otpCode": "12<3"}

	// Plain text: no escaping.
	require.Equal(t, "Code: 12<3", substituteCtx("Code: {{ctx(otpCode)}}", data, false))
	// HTML: value escaped.
	require.Equal(t, "Code: 12&lt;3", substituteCtx("Code: {{ctx(otpCode)}}", data, true))
	// Unknown key left literal.
	require.Equal(t, "Hi {{ctx(name)}}", substituteCtx("Hi {{ctx(name)}}", data, false))
}

func TestSubstituteDesign(t *testing.T) {
	tokens := map[string]string{"palette.primary.main": "#1a73e8"}

	require.Equal(t, "color:#1a73e8",
		substituteDesign("color:{{design(palette.primary.main)}}", tokens, false))
	// Unknown token left literal.
	require.Equal(t, "{{design(palette.secondary.main)}}",
		substituteDesign("{{design(palette.secondary.main)}}", tokens, false))
}

func TestFlattenTheme(t *testing.T) {
	theme := json.RawMessage(`{
		"defaultColorScheme": "light",
		"colorSchemes": {
			"light": {"palette": {"primary": {"main": "#fff"}}},
			"dark":  {"palette": {"primary": {"main": "#111"}, "contrast": 4.5}}
		}
	}`)

	t.Run("explicit scheme", func(t *testing.T) {
		tokens := flattenTheme(theme, ColorSchemeDark)
		require.Equal(t, "#111", tokens["palette.primary.main"])
		require.Equal(t, "4.5", tokens["palette.contrast"])
	})

	t.Run("falls back to default scheme", func(t *testing.T) {
		tokens := flattenTheme(theme, "")
		require.Equal(t, "#fff", tokens["palette.primary.main"])
	})

	t.Run("bad json yields empty map", func(t *testing.T) {
		require.Empty(t, flattenTheme(json.RawMessage(`not json`), "light"))
	})

	t.Run("nil theme yields empty map", func(t *testing.T) {
		require.Empty(t, flattenTheme(nil, "light"))
	})
}
