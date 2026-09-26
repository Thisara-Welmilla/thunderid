// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	i18n "github.com/thunder-id/thunderid/internal/system/i18n/mgt"
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
)

// stubTranslator resolves keys from a fixed map; unknown keys report not-found.
type stubTranslator struct{ vals map[string]string }

func (s stubTranslator) ResolveTranslationsForKey(_ context.Context, lang, ns, key string) (
	*i18n.TranslationResponse, *tidcommon.ServiceError) {
	if v, ok := s.vals[key]; ok {
		return &i18n.TranslationResponse{Language: lang, Namespace: ns, Key: key, Value: v}, nil
	}
	return nil, &i18n.ErrorTranslationNotFound
}

func TestProviderResolve_Email(t *testing.T) {
	store := newMemStore()
	store.templates["t1"] = templateDAO{
		ID:      "t1",
		Channel: ChannelEmail,
		Name:    "OTP",
		Content: TemplateContent{ContentType: ContentTypeHTML, Subject: "sub.key", Body: "body.key"},
		Design:  &TemplateDesign{ColorScheme: ColorSchemeDark},
	}
	tr := stubTranslator{vals: map[string]string{
		"sub.key":  "Your verification code",
		"body.key": "Code <b>{{ctx(otpCode)}}</b> color {{design(palette.primary.main)}}",
	}}
	p := newTemplateProvider(store, tr)

	theme := json.RawMessage(`{"colorSchemes":{"dark":{"palette":{"primary":{"main":"#111"}}}}}`)
	rc, err := p.Resolve(context.Background(), ChannelEmail, "t1", RenderInput{
		Locale: "en-US",
		Data:   map[string]string{"otpCode": "123"},
		Design: &ResolvedDesign{Theme: theme},
	})
	require.Nil(t, err)
	require.Equal(t, ContentTypeHTML, rc.ContentType)
	require.Equal(t, "Your verification code", rc.Subject)
	require.Equal(t, "Code <b>123</b> color #111", rc.Body)
}

func TestProviderResolve_SMS(t *testing.T) {
	store := newMemStore()
	store.templates["s1"] = templateDAO{
		ID:      "s1",
		Channel: ChannelSMS,
		Name:    "OTP",
		Content: TemplateContent{ContentType: ContentTypePlain, Body: "sms.body.key"},
	}
	tr := stubTranslator{vals: map[string]string{"sms.body.key": "Code {{ctx(otpCode)}}"}}
	p := newTemplateProvider(store, tr)

	rc, err := p.Resolve(context.Background(), ChannelSMS, "s1", RenderInput{
		Data: map[string]string{"otpCode": "123"},
	})
	require.Nil(t, err)
	require.Equal(t, ContentTypePlain, rc.ContentType)
	require.Empty(t, rc.Subject)
	require.Equal(t, "Code 123", rc.Body)
}

func TestProviderResolve_MissingTranslation(t *testing.T) {
	store := newMemStore()
	store.templates["t1"] = templateDAO{
		ID: "t1", Channel: ChannelSMS, Name: "OTP",
		Content: TemplateContent{ContentType: ContentTypePlain, Body: "absent.key"},
	}
	p := newTemplateProvider(store, stubTranslator{vals: map[string]string{}})

	_, err := p.Resolve(context.Background(), ChannelSMS, "t1", RenderInput{})
	require.NotNil(t, err)
	// A missing translation is surfaced as the distinct, legible NTM-1016, not a generic 500.
	require.Equal(t, ErrorTranslationNotResolved.Code, err.Code)
}

func TestProviderResolve_Errors(t *testing.T) {
	p := newTemplateProvider(newMemStore(), stubTranslator{})

	_, err := p.Resolve(context.Background(), "push", "t1", RenderInput{})
	require.Equal(t, ErrorInvalidChannel.Code, err.Code)

	_, err = p.Resolve(context.Background(), ChannelEmail, "missing", RenderInput{})
	require.Equal(t, ErrorTemplateNotFound.Code, err.Code)
}
