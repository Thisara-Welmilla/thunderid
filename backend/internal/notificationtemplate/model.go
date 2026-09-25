// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package notificationtemplate manages the email and SMS notification templates ThunderID sends.
// A template is language-neutral: its subject and body reference translation keys resolved at render
// time. The module is channel-generic; per-channel rules live behind a channelHandler (see channel.go).
package notificationtemplate

import "encoding/json"

// TemplateContent is the language-neutral content of a template, one common shape for every channel.
// Fields that do not apply to a channel are left empty. It is persisted as the CONTENT JSON column.
type TemplateContent struct {
	ContentType string `json:"contentType,omitempty"`
	Subject     string `json:"subject,omitempty"`
	Body        string `json:"body"`
}

// TemplateDesign holds a template's design references (email only). Persisted in the companion
// NOTIFICATION_TEMPLATE_DESIGN table; nil for channels without a design.
type TemplateDesign struct {
	ColorScheme string `json:"colorScheme,omitempty"`
}

// Template is the full representation of a notification template.
type Template struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Self        string          `json:"self"`
	Design      *TemplateDesign `json:"design,omitempty"`
	Content     TemplateContent `json:"content"`
}

// TemplateSummary is the list-item representation of a notification template.
type TemplateSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Self        string `json:"self"`
}

// CreateTemplateRequest is the request body for creating a template. The channel is taken from the
// path, not the body.
type CreateTemplateRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Design      *TemplateDesign `json:"design,omitempty"`
	Content     TemplateContent `json:"content"`
}

// UpdateTemplateRequest is the request body for updating a template.
type UpdateTemplateRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Design      *TemplateDesign `json:"design,omitempty"`
	Content     TemplateContent `json:"content"`
}

// TemplateListResponse is the response for listing templates of a channel.
type TemplateListResponse struct {
	Templates []TemplateSummary `json:"templates"`
}

// ResolvedDesign is the design the caller has already resolved (e.g. via the Design service) and
// passes into rendering. This module composes it; it does not resolve app-to-design itself. Email only.
// Only the theme is carried — layouts are page-scoped and not applied to notifications in this phase.
type ResolvedDesign struct {
	Theme json.RawMessage
}

// RenderInput carries the per-send inputs for producing a ready-to-send notification: the recipient
// locale (for translation resolution), the caller-resolved design, and the flow context values that
// fill {{ctx(...)}} placeholders.
type RenderInput struct {
	Locale string
	Design *ResolvedDesign
	Data   map[string]string
}

// ResolvedContent is the fully rendered, ready-to-send content: translation keys resolved to text,
// with {{ctx(...)}} and {{design(...)}} substituted.
type ResolvedContent struct {
	ContentType string
	Subject     string
	Body        string
}

// templateDAO is the store-level representation of a template: content is stored as a single JSON
// column, and the design (when present) lives in a companion table.
type templateDAO struct {
	ID          string
	Channel     string
	Name        string
	Description string
	Content     TemplateContent
	Design      *TemplateDesign
}
