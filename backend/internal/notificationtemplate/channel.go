// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

	designtokens "github.com/thunder-id/thunderid/internal/design/tokens"
	systemplate "github.com/thunder-id/thunderid/internal/system/template"
)

// channelHandler encapsulates the per-channel behavior of a template: which content fields are valid,
// whether a design applies, and the canonical stored shape. Everything else in the module is
// channel-agnostic. A new channel is added by implementing this and registering it in handlerFor.
type channelHandler interface {
	// validate checks the channel-specific constraints of a create/update request. Channel-agnostic
	// checks (name and body required) are done by the service before this is called.
	validate(content TemplateContent, design *TemplateDesign) *tidcommon.ServiceError

	// normalize returns the canonical content and design to persist for this channel. A nil design
	// means no design row is stored.
	normalize(content TemplateContent, design *TemplateDesign) (TemplateContent, *TemplateDesign)

	// resolve produces the fully rendered content for this channel. The per-channel differences live in
	// the implementations: emailHandler resolves subject+body and substitutes {{design(...)}} from the
	// passed-in design; smsHandler resolves the body only, plain text, with no subject and no design.
	// Both resolve translation keys via translate and substitute {{ctx(...)}} from in.Data.
	resolve(content TemplateContent, design *TemplateDesign, in RenderInput, translate translateFunc) (
		ResolvedContent, *tidcommon.ServiceError)
}

// handlerFor returns the handler for a channel. It is the single switch over channels in the module;
// an unknown channel is rejected here so every entry point validates the channel through one place.
func handlerFor(channel string) (channelHandler, *tidcommon.ServiceError) {
	switch channel {
	case ChannelEmail:
		return emailHandler{}, nil
	case ChannelSMS:
		return smsHandler{}, nil
	default:
		return nil, &ErrorInvalidChannel
	}
}

// validateChannel reports whether the channel is supported, reusing handlerFor's single switch for
// entry points that carry no content (list, get, delete).
func validateChannel(channel string) *tidcommon.ServiceError {
	_, svcErr := handlerFor(channel)
	return svcErr
}

// emailHandler handles the email channel: an HTML body, an optional subject, and an optional
// light/dark color scheme. The content type is always text/html internally.
type emailHandler struct{}

func (emailHandler) validate(_ TemplateContent, design *TemplateDesign) *tidcommon.ServiceError {
	if design != nil && design.ColorScheme != "" &&
		design.ColorScheme != ColorSchemeLight && design.ColorScheme != ColorSchemeDark {
		return &ErrorInvalidColorScheme
	}
	return nil
}

func (emailHandler) normalize(content TemplateContent, design *TemplateDesign) (
	TemplateContent, *TemplateDesign) {
	// Email is always rendered as HTML; the content type is server-derived, not client-chosen.
	content.ContentType = ContentTypeHTML
	// A design with no color scheme carries nothing to store; treat it as absent. The default color
	// scheme is applied later at resolution time, not persisted here.
	if design != nil && design.ColorScheme == "" {
		design = nil
	}
	return content, design
}

func (emailHandler) resolve(content TemplateContent, design *TemplateDesign, in RenderInput,
	translate translateFunc) (ResolvedContent, *tidcommon.ServiceError) {
	subject, svcErr := translate(content.Subject)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	body, svcErr := translate(content.Body)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}

	// Design tokens are substituted before ctx values so that a ctx value which happens to contain a
	// {{design(...)}} token is not re-interpreted by the design pass (design tokens come from the theme;
	// ctx values come from the flow context). {{design}} substitution is owned by the design feature;
	// {{ctx}} substitution is shared with system/template. Subject is plain text; body is HTML, so
	// substituted values are HTML-escaped there.
	if in.Design != nil {
		scheme := ""
		if design != nil {
			scheme = design.ColorScheme
		}
		subject = designtokens.Substitute(subject, in.Design.Theme, scheme, false)
		body = designtokens.Substitute(body, in.Design.Theme, scheme, true)
	}

	subject = systemplate.SubstituteCtx(subject, in.Data, false)
	body = systemplate.SubstituteCtx(body, in.Data, true)

	return ResolvedContent{ContentType: ContentTypeHTML, Subject: subject, Body: body}, nil
}

// smsHandler handles the SMS channel: a plain-text body only. Subject and design do not apply and are
// rejected so persisted objects are always valid for their channel at runtime.
type smsHandler struct{}

func (smsHandler) validate(content TemplateContent, design *TemplateDesign) *tidcommon.ServiceError {
	if content.Subject != "" {
		return &ErrorSubjectNotAllowed
	}
	if design != nil {
		return &ErrorDesignNotAllowed
	}
	return nil
}

func (smsHandler) normalize(content TemplateContent, _ *TemplateDesign) (
	TemplateContent, *TemplateDesign) {
	return TemplateContent{ContentType: ContentTypePlain, Body: content.Body}, nil
}

func (smsHandler) resolve(content TemplateContent, _ *TemplateDesign, in RenderInput,
	translate translateFunc) (ResolvedContent, *tidcommon.ServiceError) {
	body, svcErr := translate(content.Body)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	// Plain text: no HTML escaping and no design.
	body = systemplate.SubstituteCtx(body, in.Data, false)
	return ResolvedContent{ContentType: ContentTypePlain, Body: body}, nil
}
