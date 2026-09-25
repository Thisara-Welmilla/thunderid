// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

// channelHandler encapsulates the per-channel behavior of a template. Everything that differs
// between channels — which content fields are valid, whether a design applies, what the canonical
// stored shape is — lives behind this interface. The rest of the module (service, store, handler,
// schema) is channel-agnostic.
//
// A new channel is added by implementing this interface and registering it in handlerFor; no other
// file changes.
type channelHandler interface {
	// validate checks the channel-specific constraints of a create/update request. Channel-agnostic
	// checks (name and body required) are done by the service before this is called.
	validate(content TemplateContent, design *TemplateDesign) *tidcommon.ServiceError

	// normalize returns the canonical content and design to persist for this channel, coercing or
	// dropping fields that do not apply (for example forcing SMS to text/plain and discarding its
	// subject and design). Returning a nil design means no design row is stored.
	normalize(content TemplateContent, design *TemplateDesign) (TemplateContent, *TemplateDesign)
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

// validateChannel reports whether the channel is supported, reusing the single switch in handlerFor
// for entry points that carry no content (list, get, delete).
func validateChannel(channel string) *tidcommon.ServiceError {
	_, svcErr := handlerFor(channel)
	return svcErr
}

// emailHandler handles the email channel: HTML or plain body, an optional subject, and an optional
// light/dark color scheme.
type emailHandler struct{}

func (emailHandler) validate(content TemplateContent, design *TemplateDesign) *tidcommon.ServiceError {
	if content.ContentType != "" &&
		content.ContentType != ContentTypeHTML && content.ContentType != ContentTypePlain {
		return &ErrorInvalidContentType
	}
	if design != nil && design.ColorScheme != "" &&
		design.ColorScheme != ColorSchemeLight && design.ColorScheme != ColorSchemeDark {
		return &ErrorInvalidColorScheme
	}
	return nil
}

func (emailHandler) normalize(content TemplateContent, design *TemplateDesign) (
	TemplateContent, *TemplateDesign) {
	if content.ContentType == "" {
		content.ContentType = ContentTypeHTML
	}
	// A design with no color scheme carries nothing to store; treat it as absent.
	if design != nil && design.ColorScheme == "" {
		design = nil
	}
	return content, design
}

// smsHandler handles the SMS channel: plain-text body only. Subject, content type, and design do not
// apply and are silently dropped (the lenient behavior documented in the API contract).
type smsHandler struct{}

func (smsHandler) validate(_ TemplateContent, _ *TemplateDesign) *tidcommon.ServiceError {
	return nil
}

func (smsHandler) normalize(content TemplateContent, _ *TemplateDesign) (
	TemplateContent, *TemplateDesign) {
	return TemplateContent{
		ContentType: ContentTypePlain,
		Body:        content.Body,
	}, nil
}
