// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"errors"
	"strings"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

	designtokens "github.com/thunder-id/thunderid/internal/design/tokens"
	i18n "github.com/thunder-id/thunderid/internal/system/i18n/mgt"
	"github.com/thunder-id/thunderid/internal/system/log"
	systemplate "github.com/thunder-id/thunderid/internal/system/template"
)

const providerLoggerComponentName = "NotificationTemplateProvider"

// translationResolver is the narrow slice of the i18n service this module needs. The full
// i18n.I18nServiceInterface satisfies it.
type translationResolver interface {
	ResolveTranslationsForKey(ctx context.Context, language, namespace, key string) (
		*i18n.TranslationResponse, *tidcommon.ServiceError)
}

// TemplateProvider is the narrow runtime surface consumed by flow executors: it returns the fully
// resolved, ready-to-send content (translation keys resolved, {{ctx(...)}} and {{design(...)}}
// substituted). It intentionally exposes no CRUD — that is the management service's job.
type TemplateProvider interface {
	Resolve(ctx context.Context, channel, id string, in RenderInput) (*ResolvedContent, *tidcommon.ServiceError)
}

// templateProvider is the default implementation.
type templateProvider struct {
	store  notificationTemplateStoreInterface
	i18n   translationResolver
	logger *log.Logger
}

// newTemplateProvider creates a provider over the given store and translation resolver.
func newTemplateProvider(store notificationTemplateStoreInterface, resolver translationResolver) TemplateProvider {
	logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, providerLoggerComponentName))
	return &templateProvider{store: store, i18n: resolver, logger: logger}
}

// Resolve loads the template and produces the fully resolved, ready-to-send content for the recipient
// locale. It is the "do everything" entry point; the individual resolution steps (translation, design,
// context) are separate methods below. If any required part cannot be resolved, no content is returned.
func (p *templateProvider) Resolve(ctx context.Context, channel, id string, in RenderInput) (
	*ResolvedContent, *tidcommon.ServiceError) {
	if svcErr := validateChannel(channel); svcErr != nil {
		return nil, svcErr
	}
	if id == "" {
		return nil, &ErrorInvalidTemplateID
	}

	dao, err := p.store.GetTemplate(ctx, channel, id)
	if err != nil {
		if errors.Is(err, errTemplateNotFound) {
			return nil, &ErrorTemplateNotFound
		}
		p.logger.Error(ctx, "Failed to load template for rendering", log.String("id", id), log.Error(err))
		return nil, &tidcommon.InternalServerError
	}

	locale := in.Locale
	if locale == "" {
		locale = i18n.SystemLanguage
	}

	content, svcErr := p.resolveContent(ctx, locale, dao.Content, dao.Design, in)
	if svcErr != nil {
		return nil, svcErr
	}

	if svcErr := p.assertFullyResolved(ctx, id, content); svcErr != nil {
		return nil, svcErr
	}

	return &content, nil
}

// resolveContent renders subject + body. It is channel-agnostic: the only per-channel differences —
// whether a subject exists and whether the body is HTML (so substituted values are escaped) — are
// already encoded in the stored content (contentType, empty subject) and the passed-in design (nil when
// the channel has none).
func (p *templateProvider) resolveContent(ctx context.Context, locale string, content TemplateContent,
	design *TemplateDesign, in RenderInput) (ResolvedContent, *tidcommon.ServiceError) {
	// The subject is always plain text; the body is escaped only when the content type is HTML.
	subject, svcErr := p.renderField(ctx, locale, content.Subject, design, in, false)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	body, svcErr := p.renderField(ctx, locale, content.Body, design, in, content.ContentType == ContentTypeHTML)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	return ResolvedContent{ContentType: content.ContentType, Subject: subject, Body: body}, nil
}

// renderField runs the three resolution steps for one field, in order: translation, design, context.
// Design is applied before context so a context value that happens to contain a {{design(...)}} token is
// not reinterpreted by the design pass. An empty key (e.g. a channel with no subject) yields "".
func (p *templateProvider) renderField(ctx context.Context, locale, key string, design *TemplateDesign,
	in RenderInput, escapeHTML bool) (string, *tidcommon.ServiceError) {
	if key == "" {
		return "", nil
	}
	text, svcErr := p.resolveTranslation(ctx, locale, key)
	if svcErr != nil {
		return "", svcErr
	}
	text = applyDesignTokens(text, design, in, escapeHTML)
	text = applyContextValues(text, in, escapeHTML)
	return text, nil
}

// resolveTranslation resolves a single translation key to its localized text for the render locale. A
// missing translation fails closed with a distinct, legible error rather than a generic internal error.
func (p *templateProvider) resolveTranslation(ctx context.Context, locale, key string) (
	string, *tidcommon.ServiceError) {
	resp, tErr := p.i18n.ResolveTranslationsForKey(ctx, locale, i18n.SystemNamespace, key)
	if tErr != nil {
		if tErr.Code == i18n.ErrorTranslationNotFound.Code {
			p.logger.Warn(ctx, "Template translation key has no value for locale",
				log.String("key", key), log.String("locale", locale))
			return "", &ErrorTranslationNotResolved
		}
		p.logger.Error(ctx, "Failed to resolve translation key", log.String("key", key),
			log.String("locale", locale), log.String("errorCode", tErr.Code))
		return "", &tidcommon.InternalServerError
	}
	return resp.Value, nil
}

// applyDesignTokens substitutes {{design(...)}} tokens from the caller-resolved theme (the design feature
// owns the token grammar). It is a no-op when no design was supplied for this render.
func applyDesignTokens(text string, design *TemplateDesign, in RenderInput, escapeHTML bool) string {
	if in.Design == nil {
		return text
	}
	scheme := ""
	if design != nil {
		scheme = design.ColorScheme
	}
	return designtokens.Substitute(text, in.Design.Theme, scheme, escapeHTML)
}

// applyContextValues substitutes {{ctx(...)}} placeholders from the flow context (system/template owns
// the shared implementation).
func applyContextValues(text string, in RenderInput, escapeHTML bool) string {
	return systemplate.SubstituteCtx(text, in.Data, escapeHTML)
}

// assertFullyResolved fails closed when any {{ctx(...)}} or {{design(...)}} placeholder survived
// substitution: a not-fully-resolved notification must never be sent to a recipient.
func (p *templateProvider) assertFullyResolved(ctx context.Context, id string, content ResolvedContent) *tidcommon.ServiceError {
	for _, part := range []string{content.Subject, content.Body} {
		if strings.Contains(part, "{{ctx(") {
			p.logger.Error(ctx, "Notification has unresolved context placeholders after rendering",
				log.String("id", id))
			return &ErrorContextNotResolved
		}
		if strings.Contains(part, "{{design(") {
			p.logger.Error(ctx, "Notification has unresolved design tokens after rendering",
				log.String("id", id))
			return &ErrorDesignNotResolved
		}
	}
	return nil
}
