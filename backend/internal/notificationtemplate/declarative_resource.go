// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	declarativeresource "github.com/thunder-id/thunderid/internal/system/declarative_resource"
	"github.com/thunder-id/thunderid/internal/system/log"
	"github.com/thunder-id/thunderid/internal/system/utils"
)

// declaredTemplateNamespace keys declared template ids; must never change.
var declaredTemplateNamespace = uuid.MustParse("5f0d1c2e-9a3b-5c4d-8e6f-7a8b9c0d1e2f")

// declaredNotificationTemplate is a file-declared template (camelCase, see backend/AGENTS.md).
type declaredNotificationTemplate struct {
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

// declaredTemplateID derives a stable id from channel and handle.
func declaredTemplateID(channel, handle string) string {
	return uuid.NewSHA1(declaredTemplateNamespace, []byte(channel+":"+handle)).String()
}

// parseDeclaredTemplate reads one declared template, resolving environment references first.
func parseDeclaredTemplate(data []byte) (interface{}, error) {
	resolved, err := utils.SubstituteEnvironmentVariables(data)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve the template's environment references: %w", err)
	}
	var declared declaredNotificationTemplate
	if err := yaml.Unmarshal(resolved, &declared); err != nil {
		return nil, fmt.Errorf("failed to parse the notification template: %w", err)
	}
	return &declared, nil
}

// declaredToDAO validates a declared template and builds the DAO to store.
func declaredToDAO(declared *declaredNotificationTemplate) (templateDAO, error) {
	channel := ChannelType(declared.Channel)
	if svcErr := validateHandle(declared.Handle); svcErr != nil {
		return templateDAO{}, fmt.Errorf("invalid notification template handle %q", declared.Handle)
	}
	content := TemplateContent{Subject: declared.Content.Subject, Body: declared.Content.Body}
	var design *TemplateDesign
	if declared.Design != nil {
		design = &TemplateDesign{ColorScheme: declared.Design.ColorScheme}
	}
	dao, svcErr := buildValidatedDAO(channel, declaredTemplateID(declared.Channel, declared.Handle),
		declared.DisplayName, declared.Description, content, design)
	if svcErr != nil {
		return templateDAO{}, fmt.Errorf("invalid notification template %q: %s", declared.Handle,
			svcErr.Error.DefaultValue)
	}
	dao.Handle = declared.Handle
	return dao, nil
}

// validateDeclaredTemplate refuses a declaration that could not be applied.
func validateDeclaredTemplate(data interface{}) error {
	declared, ok := data.(*declaredNotificationTemplate)
	if !ok {
		return fmt.Errorf("invalid data type: expected *declaredNotificationTemplate")
	}
	_, err := declaredToDAO(declared)
	return err
}

// declaredTemplateStore is the loader's sink: it converts a declaration to a DAO and stores it.
type declaredTemplateStore struct {
	fileStore *templateFileStore
	logger    *log.Logger
}

// Create stores one declared template.
func (s *declaredTemplateStore) Create(_ string, data interface{}) error {
	declared, ok := data.(*declaredNotificationTemplate)
	if !ok {
		return fmt.Errorf("invalid data type: expected *declaredNotificationTemplate")
	}
	dao, err := declaredToDAO(declared)
	if err != nil {
		return err
	}
	if err := s.fileStore.put(dao); err != nil {
		return fmt.Errorf("failed to load notification template %q: %w", dao.Handle, err)
	}
	// Read at startup, outside any request.
	s.logger.Info(context.Background(), "Loaded a declared notification template",
		log.String("channel", string(dao.Channel)), log.String("handle", dao.Handle))
	return nil
}

// loadDeclarativeTemplates reads every declared template into the in-memory store.
func loadDeclarativeTemplates(fileStore *templateFileStore) error {
	logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, "NotificationTemplateDeclarative"))

	loader := declarativeresource.NewResourceLoader(declarativeresource.ResourceConfig{
		ResourceType:  resourceTypeNotificationTemplate,
		DirectoryName: "notification_templates",
		Parser:        parseDeclaredTemplate,
		Validator:     validateDeclaredTemplate,
		IDExtractor: func(data interface{}) string {
			if declared, ok := data.(*declaredNotificationTemplate); ok {
				return declaredTemplateID(declared.Channel, declared.Handle)
			}
			return ""
		},
	}, &declaredTemplateStore{fileStore: fileStore, logger: logger})

	if err := loader.LoadResources(); err != nil {
		return fmt.Errorf("failed to load notification template resources: %w", err)
	}
	return nil
}
