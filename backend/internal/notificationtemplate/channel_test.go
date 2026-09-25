// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHandlerFor(t *testing.T) {
	t.Run("email", func(t *testing.T) {
		h, err := handlerFor(ChannelEmail)
		require.Nil(t, err)
		require.IsType(t, emailHandler{}, h)
	})
	t.Run("sms", func(t *testing.T) {
		h, err := handlerFor(ChannelSMS)
		require.Nil(t, err)
		require.IsType(t, smsHandler{}, h)
	})
	t.Run("unknown", func(t *testing.T) {
		h, err := handlerFor("push")
		require.Nil(t, h)
		require.NotNil(t, err)
		require.Equal(t, ErrorInvalidChannel.Code, err.Code)
	})
}

func TestValidateChannel(t *testing.T) {
	require.Nil(t, validateChannel(ChannelEmail))
	require.Nil(t, validateChannel(ChannelSMS))
	require.NotNil(t, validateChannel(""))
	require.Equal(t, ErrorInvalidChannel.Code, validateChannel("carrier-pigeon").Code)
}

func TestEmailHandlerValidate(t *testing.T) {
	h := emailHandler{}

	require.Nil(t, h.validate(TemplateContent{Body: "b"}, nil))
	require.Nil(t, h.validate(TemplateContent{ContentType: ContentTypeHTML, Body: "b"}, nil))
	require.Nil(t, h.validate(TemplateContent{ContentType: ContentTypePlain, Body: "b"}, nil))
	require.Nil(t, h.validate(TemplateContent{Body: "b"}, &TemplateDesign{ColorScheme: ColorSchemeDark}))

	require.Equal(t, ErrorInvalidContentType.Code,
		h.validate(TemplateContent{ContentType: "application/pdf", Body: "b"}, nil).Code)
	require.Equal(t, ErrorInvalidColorScheme.Code,
		h.validate(TemplateContent{Body: "b"}, &TemplateDesign{ColorScheme: "teal"}).Code)
}

func TestEmailHandlerNormalize(t *testing.T) {
	h := emailHandler{}

	// Missing content type defaults to HTML.
	content, design := h.normalize(TemplateContent{Body: "b"}, nil)
	require.Equal(t, ContentTypeHTML, content.ContentType)
	require.Nil(t, design)

	// A design with no color scheme is treated as absent.
	_, design = h.normalize(TemplateContent{Body: "b"}, &TemplateDesign{})
	require.Nil(t, design)

	// A real color scheme is preserved and subject is kept for email.
	content, design = h.normalize(
		TemplateContent{ContentType: ContentTypePlain, Subject: "s", Body: "b"},
		&TemplateDesign{ColorScheme: ColorSchemeLight})
	require.Equal(t, ContentTypePlain, content.ContentType)
	require.Equal(t, "s", content.Subject)
	require.NotNil(t, design)
	require.Equal(t, ColorSchemeLight, design.ColorScheme)
}

func TestSMSHandlerLenient(t *testing.T) {
	h := smsHandler{}

	// SMS never rejects channel-mismatched fields.
	require.Nil(t, h.validate(TemplateContent{ContentType: ContentTypeHTML, Subject: "s", Body: "b"},
		&TemplateDesign{ColorScheme: "nonsense"}))

	// It coerces to plain text and drops subject and design.
	content, design := h.normalize(
		TemplateContent{ContentType: ContentTypeHTML, Subject: "s", Body: "b"},
		&TemplateDesign{ColorScheme: ColorSchemeDark})
	require.Equal(t, ContentTypePlain, content.ContentType)
	require.Empty(t, content.Subject)
	require.Equal(t, "b", content.Body)
	require.Nil(t, design)
}
