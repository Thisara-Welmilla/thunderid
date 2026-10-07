// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package executor

import (
	"errors"
	"fmt"
	"strings"

	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"

	"github.com/thunder-id/thunderid/internal/entityprovider"
	"github.com/thunder-id/thunderid/internal/flow/common"
	"github.com/thunder-id/thunderid/internal/flow/core"
	"github.com/thunder-id/thunderid/internal/notificationtemplate"
	"github.com/thunder-id/thunderid/internal/system/email"
	"github.com/thunder-id/thunderid/internal/system/log"
)

// emailExecutor sends emails based on the configured email template and runtime context data.
type emailExecutor struct {
	providers.Executor
	logger           *log.Logger
	emailClient      email.EmailClientInterface
	templateRenderer notificationTemplateRenderer
	entityProvider   entityprovider.EntityProviderInterface
}

// newEmailExecutor creates a new instance of the email executor.
func newEmailExecutor(flowFactory core.FlowFactoryInterface, emailClient email.EmailClientInterface,
	templateRenderer notificationTemplateRenderer,
	entityProvider entityprovider.EntityProviderInterface) *emailExecutor {
	logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, "EmailExecutor"))
	base := flowFactory.CreateExecutor(
		ExecutorNameEmailExecutor,
		providers.ExecutorTypeUtility,
		[]providers.Input{
			{Identifier: userAttributeEmail, Type: providers.InputTypeEmail, Required: true},
		},
		[]providers.Input{},
		&providers.ExecutorMeta{
			SupportedModes: []string{ExecutorModeSend},
			SupportedProperties: []providers.ExecutorSupportedProperties{
				{Property: propertyKeyEmailTemplate, IsRequired: true},
			},
		},
	)
	return &emailExecutor{
		Executor:         base,
		logger:           logger,
		emailClient:      emailClient,
		templateRenderer: templateRenderer,
		entityProvider:   entityProvider,
	}
}

// Execute sends an email using the data from the runtime context.
func (e *emailExecutor) Execute(ctx *providers.NodeContext) (*providers.ExecutorResponse, error) {
	switch ctx.ExecutorMode {
	case ExecutorModeSend:
		return e.executeSend(ctx)
	default:
		return nil, fmt.Errorf("invalid executor mode for EmailExecutor: %s", ctx.ExecutorMode)
	}
}

// executeSend resolves the email template, constructs the email, and sends it.
func (e *emailExecutor) executeSend(ctx *providers.NodeContext) (*providers.ExecutorResponse, error) {
	logger := e.logger.With(log.String(log.LoggerKeyExecutionID, ctx.ExecutionID))
	logger.Debug(ctx.Context, "Executing email executor in send mode")

	execResp := &providers.ExecutorResponse{
		AdditionalData: make(map[string]string),
		RuntimeData:    make(map[string]string),
	}

	if skip, ok := ctx.RuntimeData[common.RuntimeKeySkipDelivery]; ok && skip == dataValueTrue {
		logger.Debug(ctx.Context, "Delivery marked as skipped, completing without sending email")
		execResp.AdditionalData[common.DataEmailSent] = dataValueTrue
		execResp.Status = providers.ExecComplete
		return execResp, nil
	}

	if e.emailClient == nil {
		execResp.AdditionalData[common.DataEmailSent] = dataValueFalse
		execResp.Status = providers.ExecFailure
		execResp.Error = &ErrEmailServiceNotConfigured
		logger.Debug(ctx.Context, "Email client not configured")
		return execResp, nil
	}

	if e.templateRenderer == nil {
		return nil, errors.New("template renderer is not configured")
	}

	recipient, err := e.resolveRecipientEmail(ctx, logger)
	if err != nil {
		return nil, err
	}
	if recipient == "" {
		logger.Debug(ctx.Context, "Email recipient not found")
		execResp.Status = providers.ExecFailure
		execResp.Error = &ErrEmailRecipientMissing
		return execResp, nil
	}

	var handle string
	if tmplProp, ok := ctx.NodeProperties[propertyKeyEmailTemplate]; ok {
		tmplStr, ok := tmplProp.(string)
		if !ok {
			return nil, fmt.Errorf("invalid type for %s: expected string, got %T with value %v",
				propertyKeyEmailTemplate, tmplProp, tmplProp)
		}
		if tmplStr == "" {
			return nil, fmt.Errorf("email template property is empty in node configuration")
		}
		handle = normalizeTemplateHandle(tmplStr)
		logger.Debug(ctx.Context, "EmailExecutor: resolved email template", log.String("handle", handle))
	} else {
		return nil, fmt.Errorf("missing required property: %s", propertyKeyEmailTemplate)
	}

	templateData := e.resolveTemplateData(ctx)

	// Locale omitted (renderer falls back to system language); flow-injected locale is future work.
	rendered, svcErr := e.templateRenderer.Resolve(ctx.Context, notificationChannelEmail, handle,
		notificationtemplate.RenderInput{
			Data:    templateData,
			ThemeID: ctx.Application.ThemeID,
		})
	if svcErr != nil {
		return nil, fmt.Errorf("failed to render email template: %s", svcErr.Code)
	}

	emailData := email.EmailData{
		To:      []string{recipient},
		Subject: rendered.Subject,
		Body:    rendered.Body,
		IsHTML:  true,
	}

	if err := e.emailClient.Send(ctx.Context, emailData); err != nil {
		execResp.Status = providers.ExecFailure
		execResp.Error = &ErrEmailSendFailed
		return execResp, nil
	}

	logger.Debug(ctx.Context, "Email sent successfully", log.MaskedString("recipient", recipient))

	execResp.AdditionalData[common.DataEmailSent] = dataValueTrue
	execResp.Status = providers.ExecComplete
	return execResp, nil
}

// resolveRecipientEmail retrieves the recipient email from user inputs, runtime data, or forwarded data.
func (e *emailExecutor) resolveRecipientEmail(ctx *providers.NodeContext, logger *log.Logger) (string, error) {
	emailAttr := resolveInputIdentifierByType(ctx, providers.InputTypeEmail, userAttributeEmail)

	if recipientEmail, ok := ctx.ForwardedData[emailAttr].(string); ok && recipientEmail != "" {
		return recipientEmail, nil
	}

	if recipientEmail, ok := ctx.RuntimeData[emailAttr]; ok && recipientEmail != "" {
		return recipientEmail, nil
	}

	if recipientEmail, ok := ctx.UserInputs[emailAttr]; ok && recipientEmail != "" {
		return recipientEmail, nil
	}

	if userID, ok := ctx.RuntimeData[userAttributeUserID]; ok && userID != "" {
		if e.entityProvider == nil {
			return "", errors.New("entity provider is not configured for email resolution")
		}
		user, providerErr := e.entityProvider.GetEntity(userID)
		if providerErr != nil {
			if providerErr.Code == entityprovider.ErrorCodeEntityNotFound {
				return "", nil
			}
			return "", fmt.Errorf("failed to fetch user from entity provider: %w", providerErr)
		}
		if recipientEmail, err := GetUserAttribute(user, emailAttr); err == nil {
			return recipientEmail, nil
		}
		logger.Debug(ctx.Context, "Email attribute not found on user entity",
			log.String("attribute", emailAttr))
	}

	return "", nil
}

// normalizeTemplateHandle maps a flow node's template property value (historically an UPPER_SNAKE
// scenario name, e.g. PASSWORD_RECOVERY) to the kebab-case handle the notification template store is
// keyed by (password-recovery). The channel is supplied separately, so the handle carries no channel
// prefix.
func normalizeTemplateHandle(value string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "_", "-")
}

// resolveTemplateData extracts template data from RuntimeData, Context, and ForwardedData.
func (e *emailExecutor) resolveTemplateData(ctx *providers.NodeContext) map[string]string {
	templateData := map[string]string{}

	if ctx.RuntimeData != nil {
		for k, v := range ctx.RuntimeData {
			templateData[k] = fmt.Sprintf("%v", v)
		}
	}

	// Always set appName (empty when unset) so a template that embeds {{ctx(appName)}} resolves
	// rather than failing closed on an app with no name.
	templateData["appName"] = ctx.Application.Name
	if ctx.ForwardedData != nil {
		if forwardedTemplateData, ok := ctx.ForwardedData[common.ForwardedDataKeyTemplateData]; ok {
			switch data := forwardedTemplateData.(type) {
			case map[string]interface{}:
				for k, v := range data {
					templateData[k] = fmt.Sprintf("%v", v)
				}
			case map[string]string:
				for k, v := range data {
					templateData[k] = v
				}
			default:
				e.logger.Debug(ctx.Context, "Forwarded template data is of unknown type",
					log.String("type", fmt.Sprintf("%T", forwardedTemplateData)))
			}
		}
	}

	return templateData
}
