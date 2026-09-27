// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package tokens composes design tokens from a resolved theme into templated content. It owns the
// {{design(...)}} placeholder syntax and the knowledge of the theme's token structure
// (colorSchemes.<scheme>.<dot.path>), so consumers such as notification rendering can apply design
// without depending on the theme's internal shape.
//
// Escaping caveat: escapeHTML applies HTML text escaping only. Design tokens are frequently used in
// CSS, style attributes, or URLs, where HTML escaping is neither sufficient nor correct. Token values
// are therefore expected to be validated/whitelisted upstream (constrained to color/dimension/font
// grammars) by the design feature; this package does not sanitize for CSS/attribute/URL contexts.
package tokens

import (
	"bytes"
	"encoding/json"
	"html"
	"regexp"
	"strings"
)

// designPlaceholderRegex matches {{design(dot.path)}} references into the selected color scheme.
var designPlaceholderRegex = regexp.MustCompile(`\{\{design\(([\w.]+)\)\}\}`)

// Substitute replaces {{design(path)}} placeholders in content with the matching token from theme,
// selecting colorScheme (falling back to the theme's defaultColorScheme when colorScheme is empty).
// Substituted values are HTML-escaped when escapeHTML is set (see the package escaping caveat).
// Unknown tokens, an empty theme, or unparseable theme JSON leave the placeholders literal so
// rendering degrades gracefully.
func Substitute(content string, theme json.RawMessage, colorScheme string, escapeHTML bool) string {
	// Fast path: skip the JSON parse + flatten entirely when there is nothing to substitute.
	if !strings.Contains(content, "{{design(") {
		return content
	}

	tokens := flatten(theme, colorScheme)
	if len(tokens) == 0 {
		return content
	}
	return designPlaceholderRegex.ReplaceAllStringFunc(content, func(match string) string {
		sub := designPlaceholderRegex.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		if val, ok := tokens[sub[1]]; ok {
			if escapeHTML {
				return html.EscapeString(val)
			}
			return val
		}
		return match
	})
}

// flatten selects a color scheme from a theme JSON and flattens its tokens into a dot-path -> value
// map (e.g. "palette.primary.main" -> "#1a73e8"). An empty colorScheme falls back to the theme's
// defaultColorScheme. Returns an empty map on any parse or navigation failure. Numbers preserve their
// authored form (via json.Number). Keys that contain literal dots are ambiguous against nested paths;
// well-formed themes avoid them.
func flatten(theme json.RawMessage, colorScheme string) map[string]string {
	tokens := map[string]string{}
	if len(theme) == 0 {
		return tokens
	}

	dec := json.NewDecoder(bytes.NewReader(theme))
	dec.UseNumber()
	var root map[string]interface{}
	if err := dec.Decode(&root); err != nil {
		return tokens
	}

	scheme := colorScheme
	if scheme == "" {
		if def, ok := root["defaultColorScheme"].(string); ok {
			scheme = def
		}
	}

	schemes, ok := root["colorSchemes"].(map[string]interface{})
	if !ok {
		return tokens
	}
	selected, ok := schemes[scheme].(map[string]interface{})
	if !ok {
		return tokens
	}

	flattenInto("", selected, tokens)
	return tokens
}

// flattenInto walks a nested JSON object, writing scalar leaves into out keyed by their dot-path.
// Arrays of scalars are joined with ", " (e.g. a font-family stack); nulls and nested non-scalar
// array elements are skipped.
func flattenInto(prefix string, m map[string]interface{}, out map[string]string) {
	for k, v := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch val := v.(type) {
		case map[string]interface{}:
			flattenInto(key, val, out)
		case []interface{}:
			if s, ok := joinScalars(val); ok {
				out[key] = s
			}
		default:
			if s, ok := scalarToString(v); ok {
				out[key] = s
			}
		}
	}
}

// joinScalars renders an array of scalar values as a comma-separated string, reporting false when the
// array is empty or contains a non-scalar element.
func joinScalars(arr []interface{}) (string, bool) {
	if len(arr) == 0 {
		return "", false
	}
	parts := make([]string, 0, len(arr))
	for _, e := range arr {
		s, ok := scalarToString(e)
		if !ok {
			return "", false
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, ", "), true
}

// scalarToString converts a JSON scalar (string, number, bool) to its string form, preserving the
// authored numeric form via json.Number. Returns false for null or non-scalar values.
func scalarToString(v interface{}) (string, bool) {
	switch val := v.(type) {
	case string:
		return val, true
	case json.Number:
		return val.String(), true
	case bool:
		if val {
			return "true", true
		}
		return "false", true
	default:
		return "", false
	}
}
