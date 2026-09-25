// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

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

	// resolve produces the fully rendered content for this channel: it resolves the applicable
	// translation keys via translate, substitutes {{ctx(...)}} from in.Data, and (for channels with a
	// design) substitutes {{design(...)}} from the passed-in branding. It reports whether branding was
	// applied.
	resolve(content TemplateContent, design *TemplateDesign, in RenderInput, translate translateFunc) (
		ResolvedContent, bool, *tidcommon.ServiceError)
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
	translate translateFunc) (ResolvedContent, bool, *tidcommon.ServiceError) {
	subject, svcErr := translate(content.Subject)
	if svcErr != nil {
		return ResolvedContent{}, false, svcErr
	}
	body, svcErr := translate(content.Body)
	if svcErr != nil {
		return ResolvedContent{}, false, svcErr
	}

	// Subject is plain text; body is HTML, so escape substituted values there.
	subject = substituteCtx(subject, in.Data, false)
	body = substituteCtx(body, in.Data, true)

	brandingApplied := false
	if in.Branding != nil && len(in.Branding.Theme) > 0 {
		scheme := ""
		if design != nil {
			scheme = design.ColorScheme
		}
		if tokens := flattenTheme(in.Branding.Theme, scheme); len(tokens) > 0 {
			subject = substituteDesign(subject, tokens, false)
			body = substituteDesign(body, tokens, true)
			brandingApplied = true
		}
	}

	return ResolvedContent{ContentType: ContentTypeHTML, Subject: subject, Body: body}, brandingApplied, nil
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
	translate translateFunc) (ResolvedContent, bool, *tidcommon.ServiceError) {
	body, svcErr := translate(content.Body)
	if svcErr != nil {
		return ResolvedContent{}, false, svcErr
	}
	// Plain text: no HTML escaping and no branding.
	body = substituteCtx(body, in.Data, false)
	return ResolvedContent{ContentType: ContentTypePlain, Body: body}, false, nil
}
