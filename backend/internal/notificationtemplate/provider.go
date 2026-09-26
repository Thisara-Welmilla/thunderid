// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"errors"
	"strings"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

	i18n "github.com/thunder-id/thunderid/internal/system/i18n/mgt"
	"github.com/thunder-id/thunderid/internal/system/log"
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
	handler, svcErr := handlerFor(channel)
	if svcErr != nil {
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

	content, svcErr := handler.resolve(dao.Content, dao.Design, in, translate)
	if svcErr != nil {
		return nil, svcErr
	}

	// Graceful degradation leaves unresolved placeholders literal; surface a signal so a misconfigured
	// template (missing ctx value or absent design) does not ship broken content silently.
	p.warnUnresolvedPlaceholders(ctx, id, content)

	return &content, nil
}

// warnUnresolvedPlaceholders logs when {{ctx(...)}} or {{design(...)}} tokens survive substitution,
// which means a runtime value or design token was missing for this render.
func (p *templateProvider) warnUnresolvedPlaceholders(ctx context.Context, id string, content ResolvedContent) {
	for _, part := range []string{content.Subject, content.Body} {
		if strings.Contains(part, "{{ctx(") || strings.Contains(part, "{{design(") {
			p.logger.Warn(ctx, "Notification content has unresolved placeholders after rendering",
				log.String("id", id))
			return
		}
	}
}
