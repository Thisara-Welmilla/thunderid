// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"errors"
	"regexp"
	"strings"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"

	designtokens "github.com/thunder-id/thunderid/internal/design/tokens"
	i18n "github.com/thunder-id/thunderid/internal/system/i18n/mgt"
	"github.com/thunder-id/thunderid/internal/system/log"
	systemplate "github.com/thunder-id/thunderid/internal/system/template"
)

// i18nPlaceholderRegex matches {{i18n(key)}} translation-key references embedded in a template field.
// A field may hold zero, one, or many; keys may contain dots and hyphens (e.g. notification.otp.body).
var i18nPlaceholderRegex = regexp.MustCompile(`\{\{i18n\(([\w.-]+)\)\}\}`)

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
	logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, "NotificationTemplateProvider"))
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

	content, svcErr := p.resolveContent(ctx, in.Locale, dao.Content, dao.Design, in)
	if svcErr != nil {
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

// renderField is a thin orchestrator: it runs the three resolvers for one field in order (translation,
// design, context) and returns the first error. Each resolver owns its own logic and validation; this
// method only chains them. Order matters: translations first (a translated string may itself contain
// {{design(...)}}/{{ctx(...)}} placeholders), then design, then context last so a context value is never
// reinterpreted by a later pass. `template` is the stored field value (subject or body).
func (p *templateProvider) renderField(ctx context.Context, locale, template string, design *TemplateDesign,
	in RenderInput, escapeHTML bool) (string, *tidcommon.ServiceError) {
	text, svcErr := p.applyTranslations(ctx, locale, template)
	if svcErr != nil {
		return "", svcErr
	}
	text, svcErr = p.applyDesignTokens(ctx, text, design, in, escapeHTML)
	if svcErr != nil {
		return "", svcErr
	}
	return p.applyContextValues(ctx, text, in, escapeHTML)
}

// applyTranslations substitutes every {{i18n(key)}} placeholder in text with its localized value for the
// render locale — a field may contain zero, one, or many keys interleaved with markup. It owns locale
// defaulting and its own validation: a key with no value fails closed with a distinct, legible error.
// Translated values are content (they may legitimately contain markup or further {{ctx}}/{{design}}
// placeholders), so they are not HTML-escaped here; escaping applies only to design/context values.
func (p *templateProvider) applyTranslations(ctx context.Context, locale, text string) (
	string, *tidcommon.ServiceError) {
	if locale == "" {
		locale = i18n.SystemLanguage
	}

	var svcErr *tidcommon.ServiceError
	out := i18nPlaceholderRegex.ReplaceAllStringFunc(text, func(match string) string {
		if svcErr != nil {
			return match
		}
		key := i18nPlaceholderRegex.FindStringSubmatch(match)[1]
		resp, tErr := p.i18n.ResolveTranslationsForKey(ctx, locale, i18n.SystemNamespace, key)
		if tErr != nil {
			if tErr.Code == i18n.ErrorTranslationNotFound.Code {
				p.logger.Warn(ctx, "Template translation key has no value for locale",
					log.String("key", key), log.String("locale", locale))
				svcErr = &ErrorTranslationNotResolved
			} else {
				p.logger.Error(ctx, "Failed to resolve translation key", log.String("key", key),
					log.String("locale", locale), log.String("errorCode", tErr.Code))
				svcErr = &tidcommon.InternalServerError
			}
			return match
		}
		return resp.Value
	})
	if svcErr != nil {
		return "", svcErr
	}
	return out, nil
}

// applyDesignTokens substitutes {{design(...)}} tokens from the caller-resolved theme (the design feature
// owns the token grammar) and validates its own output: a token left unresolved fails closed, so a
// partially-branded notification is never sent. A no-op when no design was supplied for this render.
func (p *templateProvider) applyDesignTokens(ctx context.Context, text string, design *TemplateDesign,
	in RenderInput, escapeHTML bool) (string, *tidcommon.ServiceError) {
	if in.Design != nil {
		scheme := ""
		if design != nil {
			scheme = design.ColorScheme
		}
		text = designtokens.Substitute(text, in.Design.Theme, scheme, escapeHTML)
	}
	if strings.Contains(text, "{{design(") {
		p.logger.Error(ctx, "Unresolved design token after substitution")
		return "", &ErrorDesignNotResolved
	}
	return text, nil
}

// applyContextValues substitutes {{ctx(...)}} placeholders from the flow context (system/template owns
// the shared implementation) and validates its own output: a placeholder left unresolved fails closed,
// so a token is never shipped to a recipient.
func (p *templateProvider) applyContextValues(ctx context.Context, text string, in RenderInput,
	escapeHTML bool) (string, *tidcommon.ServiceError) {
	text = systemplate.SubstituteCtx(text, in.Data, escapeHTML)
	if strings.Contains(text, "{{ctx(") {
		p.logger.Error(ctx, "Unresolved context placeholder after substitution")
		return "", &ErrorContextNotResolved
	}
	return text, nil
}
