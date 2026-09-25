// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package template

import (
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
