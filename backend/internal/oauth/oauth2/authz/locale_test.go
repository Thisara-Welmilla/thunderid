// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package authz

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveUILocale(t *testing.T) {
	cases := []struct {
		name      string
		uiLocales string
		expected  string
	}{
		{"single valid tag", "fr-FR", "fr-FR"},
		{"empty", "", ""},
		{"whitespace only", "   ", ""},
		{"first of a priority list wins", "fr-FR en-US", "fr-FR"},
		{"skips invalid, uses first valid", "$$ en-US", "en-US"},
		{"canonicalises case", "en-us", "en-US"},
		{"no valid tag", "$$ ^^", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, resolveUILocale(tc.uiLocales))
		})
	}
}
