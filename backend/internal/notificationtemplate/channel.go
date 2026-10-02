// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"strings"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
)

// channelRules encapsulates a channel's specific validation and normalization: which fields are valid
// for the channel and the canonical stored shape. It operates on the single templateDAO model rather
// than a channel-specific one, so adding a field is a struct change, not a signature change. Everything
// else in the module is channel-agnostic; a new channel is added by implementing this and registering
// it in rulesFor.
type channelRules interface {
	// validate checks the channel-specific constraints of a create/update request. Channel-agnostic
	// checks (displayName and body required) are done by the service before this is called.
	validate(dao templateDAO) *tidcommon.ServiceError

	// normalize returns the canonical dao to persist for this channel. A nil design means the
	// COLOR_SCHEME column is stored as NULL.
	normalize(dao templateDAO) templateDAO
}

// rulesFor returns the rules for a channel. It is the single switch over channels in the module;
// an unknown channel is rejected here so every entry point validates the channel through one place.
func rulesFor(channel string) (channelRules, *tidcommon.ServiceError) {
	switch channel {
	case channelEmail:
		return emailRules{}, nil
	case channelSMS:
		return smsRules{}, nil
	default:
		return nil, &ErrorInvalidChannel
	}
}

// validateChannel reports whether the channel is supported, reusing rulesFor's single switch for
// entry points that carry no content (list, get, delete).
func validateChannel(channel string) *tidcommon.ServiceError {
	_, svcErr := rulesFor(channel)
	return svcErr
}

// emailRules holds the rules for the email channel: an HTML body, an optional subject, and an optional
// light/dark color scheme.
type emailRules struct{}

func (emailRules) validate(dao templateDAO) *tidcommon.ServiceError {
	// Email requires a subject (SMS, by contrast, rejects one).
	if strings.TrimSpace(dao.Content.Subject) == "" {
		return &ErrorMissingSubject
	}
	design := dao.Design
	if design != nil && design.ColorScheme != "" &&
		design.ColorScheme != colorSchemeLight && design.ColorScheme != colorSchemeDark {
		return &ErrorInvalidColorScheme
	}
	// Email supports design tokens in the body (not the subject).
	return validatePlaceholders(dao.Content, true)
}

func (emailRules) normalize(dao templateDAO) templateDAO {
	// A design with no color scheme carries nothing to store; treat it as absent. The default color
	// scheme is applied later at resolution time, not persisted here.
	if dao.Design != nil && dao.Design.ColorScheme == "" {
		dao.Design = nil
	}
	return dao
}

// smsRules holds the rules for the SMS channel: a plain-text body only. Subject and design do not apply
// and are rejected so persisted objects are always valid for their channel at runtime.
type smsRules struct{}

func (smsRules) validate(dao templateDAO) *tidcommon.ServiceError {
	if dao.Content.Subject != "" {
		return &ErrorSubjectNotAllowed
	}
	if dao.Design != nil {
		return &ErrorDesignNotAllowed
	}
	// SMS has no design, so design tokens are not allowed anywhere in its content.
	return validatePlaceholders(dao.Content, false)
}

func (smsRules) normalize(dao templateDAO) templateDAO {
	dao.Content = TemplateContent{Body: dao.Content.Body}
	dao.Design = nil
	return dao
}
