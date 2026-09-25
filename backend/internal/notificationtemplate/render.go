// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"encoding/json"
	"html"
	"regexp"
	"strconv"
)

// Placeholder syntaxes substituted at render time:
//
//	{{ctx(key)}}      -> a runtime value from the flow context (RenderInput.Data)
//	{{design(path)}}  -> a design token from the resolved theme, addressed by dot-path
//	                     into the selected color scheme's palette (e.g. palette.primary.main)
var (
	ctxPlaceholderRegex    = regexp.MustCompile(`\{\{ctx\((\w+)\)}}`)
	designPlaceholderRegex = regexp.MustCompile(`\{\{design\(([\w.]+)\)}}`)
)

// substituteCtx replaces {{ctx(key)}} occurrences with data[key], HTML-escaping the value when
// escapeHTML is set. An unknown key is left literal (so previews without context show the token).
func substituteCtx(s string, data map[string]string, escapeHTML bool) string {
	return ctxPlaceholderRegex.ReplaceAllStringFunc(s, func(match string) string {
		sub := ctxPlaceholderRegex.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		if val, ok := data[sub[1]]; ok {
			if escapeHTML {
				return html.EscapeString(val)
			}
			return val
		}
		return match
	})
}

// substituteDesign replaces {{design(path)}} occurrences with tokens[path], HTML-escaping the value
// when escapeHTML is set. An unknown token is left literal.
func substituteDesign(s string, tokens map[string]string, escapeHTML bool) string {
	return designPlaceholderRegex.ReplaceAllStringFunc(s, func(match string) string {
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

// flattenTheme selects a color scheme from a resolved theme JSON and flattens its tokens into a
// dot-path -> value map (e.g. "palette.primary.main" -> "#1a73e8"). colorScheme picks the scheme; an
// empty colorScheme falls back to the theme's defaultColorScheme. Returns an empty map on any parse
// or navigation failure so rendering degrades to leaving {{design(...)}} tokens literal.
func flattenTheme(theme json.RawMessage, colorScheme string) map[string]string {
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
