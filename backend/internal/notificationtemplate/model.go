// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package notificationtemplate provides management of the email and SMS notification templates
// ThunderID sends. A template is language-neutral: its subject and body reference translation keys,
// and the localized text is resolved from ThunderID's translation resources at render time.
//
// The module is channel-generic: the API and storage treat a template uniformly, and the only
// per-channel behavior (which content fields apply, whether a design is allowed) lives behind a
// channelHandler selected by a switch factory (see channel.go). Adding a channel means adding a
// handler and a channel constant, not changing the store, service, or schema.
package notificationtemplate

// Notification channels.
const (
	ChannelEmail = "email"
	ChannelSMS   = "sms"
)

// Body media types.
const (
	ContentTypeHTML  = "text/html"
	ContentTypePlain = "text/plain"
)

// Color theme variants.
const (
	ColorSchemeLight = "light"
	ColorSchemeDark  = "dark"
)

// TemplateContent is the language-neutral content of a template. The subject and body reference
// translation keys; the resolved text is produced at render time. It is one common shape for every
// channel: fields that do not apply to a channel are left empty (for example Subject is empty for
// SMS). It is persisted verbatim as the CONTENT JSON column, so a new channel can introduce its own
// content fields without a schema migration.
type TemplateContent struct {
	ContentType string `json:"contentType,omitempty"`
	Subject     string `json:"subject,omitempty"`
	Body        string `json:"body"`
}

// TemplateDesign holds the per-template design references composed at render time. Email only; it is
// persisted in the NOTIFICATION_TEMPLATE_DESIGN table and is nil for channels without a design.
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

// templateDAO is the store-level representation of a template. Content is stored as a single JSON
// column; the design (when present) lives in a companion table. The DAO carries the structured
// content and design so the store owns the JSON (de)serialization and callers never see the wire
// format.
type templateDAO struct {
	ID          string
	Channel     string
	Name        string
	Description string
	Content     TemplateContent
	Design      *TemplateDesign
}
