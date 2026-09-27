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

// translateFunc resolves a single translation key to localized text. An empty key resolves to "".
type translateFunc func(key string) (string, *tidcommon.ServiceError)

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

// Resolve loads the template, resolves its translation keys for the recipient locale, and delegates to
// the channel handler to substitute {{ctx(...)}} and {{design(...)}} and produce the final content.
// If a required translation cannot be resolved, no notification is produced and the error is returned.
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

	translate := func(key string) (string, *tidcommon.ServiceError) {
		if key == "" {
			return "", nil
		}
		resp, tErr := p.i18n.ResolveTranslationsForKey(ctx, locale, i18n.SystemNamespace, key)
		if tErr != nil {
			// A missing translation is a template/config problem, not an internal fault: fail closed
			// with a distinct, legible error instead of collapsing every i18n error to a 500.
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

	content, svcErr := resolveContent(dao.Content, dao.Design, in, translate)
	if svcErr != nil {
		return nil, svcErr
	}

	if svcErr := p.checkResolved(ctx, id, content); svcErr != nil {
		return nil, svcErr
	}

	return &content, nil
}

// checkResolved fails closed when a required {{ctx(...)}} value was not supplied (an unsubstituted
// runtime token must never ship to a recipient). An unresolved {{design(...)}} token only degrades the
// look, so it is logged rather than treated as fatal.
func (p *templateProvider) checkResolved(ctx context.Context, id string, content ResolvedContent) *tidcommon.ServiceError {
	for _, part := range []string{content.Subject, content.Body} {
		if strings.Contains(part, "{{ctx(") {
			p.logger.Error(ctx, "Notification has unresolved context placeholders after rendering",
				log.String("id", id))
			return &ErrorContextNotResolved
		}
	}
	for _, part := range []string{content.Subject, content.Body} {
		if strings.Contains(part, "{{design(") {
			p.logger.Warn(ctx, "Notification has unresolved design tokens after rendering",
				log.String("id", id))
			return nil
		}
	}
	return nil
}

// resolveContent renders a template's content channel-agnostically: the only per-channel differences —
// whether a subject exists and whether the body is HTML (so its substituted values are escaped) — are
// already encoded in the stored content (contentType, empty subject) and the passed-in design (nil when
// the channel has none). Substitution is pure token replacement, identical for every channel.
func resolveContent(content TemplateContent, design *TemplateDesign, in RenderInput,
	translate translateFunc) (ResolvedContent, *tidcommon.ServiceError) {
	// The subject is always plain text; the body is escaped only when the content type is HTML.
	subject, svcErr := renderField(content.Subject, design, in, translate, false)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	body, svcErr := renderField(content.Body, design, in, translate, content.ContentType == ContentTypeHTML)
	if svcErr != nil {
		return ResolvedContent{}, svcErr
	}
	return ResolvedContent{ContentType: content.ContentType, Subject: subject, Body: body}, nil
}

// renderField resolves one content field: translation key -> text, then design tokens, then ctx values.
// Design is substituted before ctx so a ctx value that happens to contain a {{design(...)}} token is not
// reinterpreted by the design pass. An empty key (e.g. a channel with no subject) yields "".
func renderField(key string, design *TemplateDesign, in RenderInput, translate translateFunc,
	escapeHTML bool) (string, *tidcommon.ServiceError) {
	if key == "" {
		return "", nil
	}
	text, svcErr := translate(key)
	if svcErr != nil {
		return "", svcErr
	}
	if in.Design != nil {
		scheme := ""
		if design != nil {
			scheme = design.ColorScheme
		}
		text = designtokens.Substitute(text, in.Design.Theme, scheme, escapeHTML)
	}
	return systemplate.SubstituteCtx(text, in.Data, escapeHTML), nil
}
