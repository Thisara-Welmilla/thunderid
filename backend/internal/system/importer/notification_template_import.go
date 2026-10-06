// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package importer

import (
	"context"
	"fmt"

	"github.com/thunder-id/thunderid/internal/notificationtemplate"
	serverconst "github.com/thunder-id/thunderid/internal/system/constants"
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
)

// notificationTemplateAdapter is the slice of the notification template service the importer needs.
type notificationTemplateAdapter interface {
	ListTemplates(ctx context.Context, channel notificationtemplate.ChannelType, limit, offset int) (
		*notificationtemplate.TemplateListResponse, *tidcommon.ServiceError)
	CreateTemplate(ctx context.Context, channel notificationtemplate.ChannelType,
		request notificationtemplate.CreateTemplateRequest) (*notificationtemplate.Template, *tidcommon.ServiceError)
	UpdateTemplate(ctx context.Context, channel notificationtemplate.ChannelType, id string,
		request notificationtemplate.UpdateTemplateRequest) (*notificationtemplate.Template, *tidcommon.ServiceError)
}

// notificationTemplateImportDoc is the import document shape for a notification template. It mirrors
// the API create model (CreateEmailTemplateRequest / CreateSmsTemplateRequest) with an added channel
// discriminator; the channel is taken from here rather than a path as in the HTTP API.
type notificationTemplateImportDoc struct {
	Channel     string `yaml:"channel"`
	Handle      string `yaml:"handle"`
	DisplayName string `yaml:"displayName"`
	Description string `yaml:"description"`
	Content     struct {
		Subject string `yaml:"subject"`
		Body    string `yaml:"body"`
	} `yaml:"content"`
	Design *struct {
		ColorScheme string `yaml:"colorScheme"`
	} `yaml:"design"`
}

// importNotificationTemplate imports a "notification_template" document. Templates are keyed by their
// (channel, handle); the id is server-assigned, so an existing template is matched by handle and
// updated in place when upsert is enabled.
func (s *importService) importNotificationTemplate(
	ctx context.Context, doc parsedDocument, options *ImportOptions, dryRun bool,
) ImportItemOutcome {
	if s.notifTemplateService == nil {
		return unsupportedAdapterOutcome(resourceTypeNotificationTemplate, "notification template")
	}

	var raw notificationTemplateImportDoc
	if err := doc.Node.Decode(&raw); err != nil {
		return decodeErrorOutcome(resourceTypeNotificationTemplate, "", raw.Handle, err)
	}

	channel := notificationtemplate.ChannelType(raw.Channel)
	content := notificationtemplate.TemplateContent{Subject: raw.Content.Subject, Body: raw.Content.Body}
	var design *notificationtemplate.TemplateDesign
	if raw.Design != nil {
		design = &notificationtemplate.TemplateDesign{ColorScheme: raw.Design.ColorScheme}
	}

	if msg := validateNotificationTemplateDoc(raw); msg != "" {
		return ImportItemOutcome{
			ResourceType: resourceTypeNotificationTemplate,
			ResourceName: raw.Handle,
			Status:       statusFailed,
			Code:         ErrorInvalidYAMLContent.Code,
			Message:      msg,
		}
	}

	// Resolve whether the handle already exists so both the dry run and the real apply report the
	// correct create/update operation. Only meaningful when upsert is enabled.
	existingID := ""
	if options.IsUpsertEnabled() {
		id, lookupErr := s.findNotificationTemplateIDByHandle(ctx, channel, raw.Handle)
		if lookupErr != nil {
			return serviceErrorOutcome(resourceTypeNotificationTemplate, "", raw.Handle, operationUpdate, lookupErr)
		}
		existingID = id
	}

	if dryRun {
		op := operationCreate
		if existingID != "" {
			op = operationUpdate
		}
		return successOutcome(resourceTypeNotificationTemplate, existingID, raw.Handle, op)
	}

	if existingID == "" {
		created, svcErr := s.notifTemplateService.CreateTemplate(ctx, channel,
			notificationtemplate.CreateTemplateRequest{
				Handle:      raw.Handle,
				DisplayName: raw.DisplayName,
				Description: raw.Description,
				Design:      design,
				Content:     content,
			})
		if svcErr == nil {
			return successOutcome(resourceTypeNotificationTemplate, created.ID, created.Handle, operationCreate)
		}
		// Create race: the handle appeared between the existence check and the insert. Fall back to
		// updating it when upsert is on; otherwise surface the conflict as a create failure.
		if svcErr.Code != notificationtemplate.ErrorTemplateHandleConflict.Code || !options.IsUpsertEnabled() {
			return serviceErrorOutcome(resourceTypeNotificationTemplate, "", raw.Handle, operationCreate, svcErr)
		}
		id, lookupErr := s.findNotificationTemplateIDByHandle(ctx, channel, raw.Handle)
		if lookupErr != nil {
			return serviceErrorOutcome(resourceTypeNotificationTemplate, "", raw.Handle, operationUpdate, lookupErr)
		}
		if id == "" {
			return serviceErrorOutcome(resourceTypeNotificationTemplate, "", raw.Handle, operationCreate, svcErr)
		}
		existingID = id
	}

	updated, updErr := s.notifTemplateService.UpdateTemplate(ctx, channel, existingID,
		notificationtemplate.UpdateTemplateRequest{
			DisplayName: raw.DisplayName,
			Description: raw.Description,
			Design:      design,
			Content:     content,
		})
	if updErr != nil {
		return serviceErrorOutcome(resourceTypeNotificationTemplate, existingID, raw.Handle, operationUpdate, updErr)
	}
	return successOutcome(resourceTypeNotificationTemplate, updated.ID, updated.Handle, operationUpdate)
}

// findNotificationTemplateIDByHandle resolves a template's server-assigned id from its handle within a
// channel, paging through the full list so a handle on a later page is not missed. Returns an empty id
// (and no error) when the handle is not present.
func (s *importService) findNotificationTemplateIDByHandle(
	ctx context.Context, channel notificationtemplate.ChannelType, handle string,
) (string, *tidcommon.ServiceError) {
	for offset := 0; ; {
		list, svcErr := s.notifTemplateService.ListTemplates(ctx, channel, serverconst.MaxPageSize, offset)
		if svcErr != nil {
			return "", svcErr
		}
		for i := range list.Templates {
			if list.Templates[i].Handle == handle {
				return list.Templates[i].ID, nil
			}
		}
		offset += len(list.Templates)
		if len(list.Templates) == 0 || offset >= list.TotalResults {
			return "", nil
		}
	}
}

// validateNotificationTemplateDoc checks the fields the real import requires, so a dry run predicts an
// apply failure instead of reporting success. It returns an empty string when the document is valid.
func validateNotificationTemplateDoc(raw notificationTemplateImportDoc) string {
	channel := notificationtemplate.ChannelType(raw.Channel)
	if channel != notificationtemplate.ChannelTypeEmail && channel != notificationtemplate.ChannelTypeSMS {
		return fmt.Sprintf("invalid channel %q: must be email or sms", raw.Channel)
	}
	if raw.Handle == "" {
		return "handle is required"
	}
	if raw.DisplayName == "" {
		return "displayName is required"
	}
	if raw.Content.Body == "" {
		return "content.body is required"
	}
	if channel == notificationtemplate.ChannelTypeEmail && raw.Content.Subject == "" {
		return "content.subject is required for the email channel"
	}
	if channel == notificationtemplate.ChannelTypeSMS && raw.Content.Subject != "" {
		return "content.subject is not allowed for the sms channel"
	}
	if channel == notificationtemplate.ChannelTypeSMS && raw.Design != nil {
		return "design is not allowed for the sms channel"
	}
	return ""
}
