// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package tokens composes design tokens from a resolved theme into templated content. It owns the
// {{design(...)}} placeholder syntax and the knowledge of the theme's token structure
// (colorSchemes.<scheme>.<dot.path>), so consumers such as notification rendering can apply design
// without depending on the theme's internal shape.
package tokens

import (
	"encoding/json"
	"html"
	"regexp"
	"strconv"
)

// designPlaceholderRegex matches {{design(dot.path)}} references into the selected color scheme.
var designPlaceholderRegex = regexp.MustCompile(`\{\{design\(([\w.]+)\)}}`)

// Substitute replaces {{design(path)}} placeholders in content with the matching token from theme,
// selecting colorScheme (falling back to the theme's defaultColorScheme when colorScheme is empty).
// Substituted values are HTML-escaped when escapeHTML is set. Unknown tokens, an empty theme, or
// unparseable theme JSON leave the placeholders literal so rendering degrades gracefully.
func Substitute(content string, theme json.RawMessage, colorScheme string, escapeHTML bool) string {
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
// defaultColorScheme. Returns an empty map on any parse or navigation failure.
func flatten(theme json.RawMessage, colorScheme string) map[string]string {
	tokens := map[string]string{}
	if len(theme) == 0 {
		return tokens
	}

	var root map[string]interface{}
	if err := json.Unmarshal(theme, &root); err != nil {
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
func flattenInto(prefix string, m map[string]interface{}, out map[string]string) {
	for k, v := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch val := v.(type) {
		case map[string]interface{}:
			flattenInto(key, val, out)
		case string:
			out[key] = val
		case float64:
			out[key] = strconv.FormatFloat(val, 'f', -1, 64)
		case bool:
			out[key] = strconv.FormatBool(val)
		}
	}
}
