// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package resolve

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
)

// designPlaceholderRegex matches a design-token placeholder, capturing the dot-path token key:
// "{{design(palette.primary.main)}}" -> "palette.primary.main". The key grammar allows word
// characters, dots, and hyphens so hyphenated theme keys (e.g. "palette.primary.on-hover") that
// flattenTokens can emit are matchable.
var designPlaceholderRegex = regexp.MustCompile(`\{\{design\(([\w.-]+)\)}}`)

// resolveApplicableTheme decodes theme JSON and returns the applicable theme: the theme root with the
// color scheme that applies (the requested one, or the theme's defaultColorScheme when that is empty or
// absent) promoted onto it, so palette.* (from the scheme) and root-level typography.*/shape.* share one
// dot-path namespace. The colorSchemes and defaultColorScheme resolution inputs are dropped. It returns
// errEmptyTheme when the theme has no content, errNoApplicableColorScheme when no scheme applies (no
// colorSchemes object, or neither the requested scheme nor the default exists within it), and
// errMalformedTheme when the theme JSON is malformed or has trailing content after the first JSON value,
// so a consumer never silently resolves against no tokens.
func resolveApplicableTheme(themeJSON json.RawMessage, colorScheme string) (map[string]interface{}, error) {
	if len(themeJSON) == 0 {
		return nil, errEmptyTheme
	}
	dec := json.NewDecoder(bytes.NewReader(themeJSON))
	dec.UseNumber()
	var root map[string]interface{}
	if err := dec.Decode(&root); err != nil {
		return nil, fmt.Errorf("%w: %v", errMalformedTheme, err)
	}
	// Reject trailing content after the first JSON value: a well-formed theme is a single object.
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errMalformedTheme
	}

	schemes, ok := root["colorSchemes"].(map[string]interface{})
	if !ok {
		return nil, errNoApplicableColorScheme
	}
	selected, ok := schemes[colorScheme].(map[string]interface{})
	if !ok {
		def, _ := root["defaultColorScheme"].(string)
		fallback, found := schemes[def].(map[string]interface{})
		if !found {
			return nil, errNoApplicableColorScheme
		}
		selected = fallback
	}

	// Promote the applicable scheme onto the root namespace and drop the scheme-selection inputs, so the
	// flattened tokens expose palette.* (from the scheme) alongside root-level typography.*/shape.*.
	delete(root, "colorSchemes")
	delete(root, "defaultColorScheme")
	for key, val := range selected {
		root[key] = val
	}
	return root, nil
}

// flattenTokens flattens a theme object into a flat dot-path -> value map (e.g. "palette.primary.main"
// -> "#fa7b3f"), recursing into nested objects under their dotted prefix. It resolves any path present
// in the theme; which tokens a consumer references is the consumer's concern. Numbers keep their
// authored form via json.Number; non-scalar leaves (arrays, null) are skipped.
func flattenTokens(prefix string, m map[string]interface{}) map[string]string {
	out := map[string]string{}
	flattenTokensInto(out, prefix, m)
	return out
}

// flattenTokensInto writes m's scalar leaves into out under their dot-path, recursing into nested
// objects. It accumulates into the single out map so no intermediate map is allocated or copied per
// nesting level.
func flattenTokensInto(out map[string]string, prefix string, m map[string]interface{}) {
	for k, v := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		if nested, ok := v.(map[string]interface{}); ok {
			flattenTokensInto(out, key, nested)
			continue
		}
		switch val := v.(type) {
		case string:
			out[key] = val
		case json.Number:
			out[key] = val.String()
		case bool:
			out[key] = strconv.FormatBool(val)
		}
	}
}

// isSafeTokenValue reports whether a resolved design-token value is free of the crudest injection
// vector: angle brackets and control characters. Legitimate design-token values (hex and rgb(a) colors,
// CSS functions such as var() and linear-gradient(), numbers, lengths, keywords, and font stacks) do not
// contain these; a value that does is treated as poisoned theme data. This is shallow defense in depth
// only; the full contract (and its limits) is documented on ResolveDesignContent.
func isSafeTokenValue(val string) bool {
	for _, r := range val {
		if r == '<' || r == '>' || r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// substituteDesignTokens replaces every {{design(<dot.path>)}} placeholder in content with the matching
// token value verbatim. A placeholder is left untouched when its key is absent from tokens or when its
// value is unsafe (see isSafeTokenValue). It returns the resolved content and the de-duplicated list of
// token keys whose values were rejected as unsafe, so the caller can log them. Substituted values are
// raw, theme-authored strings and are NOT encoded; the caller owns output encoding (see the full
// contract on ResolveDesignContent).
func substituteDesignTokens(content string, tokens map[string]string) (string, []string) {
	var dropped []string
	seen := map[string]bool{}
	resolved := designPlaceholderRegex.ReplaceAllStringFunc(content, func(match string) string {
		key := designPlaceholderRegex.FindStringSubmatch(match)[1]
		val, ok := tokens[key]
		if !ok {
			return match
		}
		if !isSafeTokenValue(val) {
			if !seen[key] {
				seen[key] = true
				dropped = append(dropped, key)
			}
			return match
		}
		return val
	})
	return resolved, dropped
}
