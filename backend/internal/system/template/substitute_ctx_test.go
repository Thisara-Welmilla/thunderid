// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package template

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSubstituteCtx(t *testing.T) {
	data := TemplateData{"otpCode": "12<3"}

	// Plain text: no escaping.
	require.Equal(t, "Code: 12<3", SubstituteCtx("Code: {{ctx(otpCode)}}", data, false))
	// HTML: substituted value escaped.
	require.Equal(t, "Code: 12&lt;3", SubstituteCtx("Code: {{ctx(otpCode)}}", data, true))
	// Unknown key left literal.
	require.Equal(t, "Hi {{ctx(name)}}", SubstituteCtx("Hi {{ctx(name)}}", data, false))
	// No placeholders: unchanged.
	require.Equal(t, "plain", SubstituteCtx("plain", data, true))
}

// TestSubstitute exercises the shared primitive directly with a dotted-argument pattern, the shape a
// new placeholder function (for example {{design(palette.primary.main)}}) reuses instead of
// re-implementing the replace loop.
func TestSubstitute(t *testing.T) {
	pattern := regexp.MustCompile(`\{\{design\(([\w.]+)\)}}`)
	tokens := map[string]string{"palette.primary.main": "#1a73e8", "raw": "<b>"}
	resolve := func(arg string) (string, bool) {
		val, ok := tokens[arg]
		return val, ok
	}

	// Dotted argument resolved.
	require.Equal(t, "color:#1a73e8",
		Substitute("color:{{design(palette.primary.main)}}", pattern, resolve, false))
	// HTML escaping applied to the substituted value.
	require.Equal(t, "&lt;b&gt;", Substitute("{{design(raw)}}", pattern, resolve, true))
	// Unknown argument left literal.
	require.Equal(t, "{{design(palette.unknown)}}",
		Substitute("{{design(palette.unknown)}}", pattern, resolve, false))
	// No placeholders: unchanged.
	require.Equal(t, "plain", Substitute("plain", pattern, resolve, true))
}
