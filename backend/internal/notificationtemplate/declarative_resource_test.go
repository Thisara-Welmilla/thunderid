// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"

	"github.com/thunder-id/thunderid/internal/system/log"
)

// declaredEmailYAML is a minimal valid email template declaration.
const declaredEmailYAML = `resource_type: notification_template
channel: email
handle: welcome
displayName: Welcome
description: Greeting
content:
  subject: Hi
  body: Hello {{ctx(name)}}
`

func loadDeclared(t *testing.T, fileStore *templateFileStore, yaml string) {
	t.Helper()
	dto, err := parseDeclaredTemplate([]byte(yaml))
	if err != nil {
		t.Fatalf("parseDeclaredTemplate: %v", err)
	}
	store := &declaredTemplateStore{fileStore: fileStore, logger: log.GetLogger()}
	if err := store.Create("", dto); err != nil {
		t.Fatalf("declaredTemplateStore.Create: %v", err)
	}
}

func TestFileStoreReadsBackWhatWasDeclared(t *testing.T) {
	ctx := context.Background()
	fileStore := newTestFileStore()
	loadDeclared(t, fileStore, declaredEmailYAML)

	got, err := fileStore.GetTemplateByHandle(ctx, ChannelTypeEmail, "welcome")
	if err != nil {
		t.Fatalf("GetTemplateByHandle: %v", err)
	}
	if got.DisplayName != "Welcome" || got.Content.Subject != "Hi" {
		t.Fatalf("unexpected template: %+v", got)
	}

	exists, _ := fileStore.IsHandleExists(ctx, ChannelTypeEmail, "welcome")
	if !exists {
		t.Fatal("expected the declared handle to exist")
	}
	if _, err := fileStore.GetTemplate(ctx, ChannelTypeSMS, got.ID); !errors.Is(err, errTemplateNotFound) {
		t.Fatalf("expected not found for the wrong channel, got %v", err)
	}
}

func TestFileStoreRefusesWrites(t *testing.T) {
	ctx := context.Background()
	fileStore := newTestFileStore()
	if err := fileStore.CreateTemplate(ctx, templateDAO{}); !errors.Is(err, errDeclarativeTemplate) {
		t.Fatalf("Create: expected errDeclarativeTemplate, got %v", err)
	}
	if err := fileStore.UpdateTemplate(ctx, templateDAO{}); !errors.Is(err, errDeclarativeTemplate) {
		t.Fatalf("Update: expected errDeclarativeTemplate, got %v", err)
	}
	if err := fileStore.DeleteTemplate(ctx, ChannelTypeEmail, "x"); !errors.Is(err, errDeclarativeTemplate) {
		t.Fatalf("Delete: expected errDeclarativeTemplate, got %v", err)
	}
}

func TestCompositeMergesAndRefusesDeclaredWrites(t *testing.T) {
	ctx := context.Background()
	fileStore := newTestFileStore()
	loadDeclared(t, fileStore, declaredEmailYAML)
	declaredID, err := fileStore.GetTemplateByHandle(ctx, ChannelTypeEmail, "welcome")
	if err != nil {
		t.Fatalf("lookup declared: %v", err)
	}

	reset := templateDAO{ID: "db-1", Channel: ChannelTypeEmail, Handle: "reset", DisplayName: "Reset",
		Content: TemplateContent{Subject: "S", Body: "B"}}
	db := newNotificationTemplateStoreInterfaceMock(t)
	db.On("ListTemplates", mock.Anything, ChannelTypeEmail, mock.Anything, mock.Anything).
		Return([]templateDAO{reset}, nil)
	db.On("UpdateTemplate", mock.Anything, reset).Return(nil).Once()
	composite := newCompositeStore(fileStore, db)

	list, err := composite.ListTemplates(ctx, ChannelTypeEmail, 100, 0)
	if err != nil {
		t.Fatalf("ListTemplates: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected both sources merged, got %d: %+v", len(list), list)
	}
	count, _ := composite.CountTemplates(ctx, ChannelTypeEmail)
	if count != 2 {
		t.Fatalf("expected count 2, got %d", count)
	}

	// A DB write goes through to the DB store.
	if err := composite.UpdateTemplate(ctx, reset); err != nil {
		t.Fatalf("DB update should succeed: %v", err)
	}
	// A declared write is refused.
	if err := composite.UpdateTemplate(ctx, declaredID); !errors.Is(err, errDeclarativeTemplate) {
		t.Fatalf("declared update: expected errDeclarativeTemplate, got %v", err)
	}
	if err := composite.DeleteTemplate(ctx, ChannelTypeEmail, declaredID.ID); !errors.Is(err, errDeclarativeTemplate) {
		t.Fatalf("declared delete: expected errDeclarativeTemplate, got %v", err)
	}
	// Declared writes must never reach the DB store.
	db.AssertExpectations(t)
}

func TestDeclaredTemplateValidationRejectsBadDoc(t *testing.T) {
	// SMS with a subject is invalid.
	const badSMS = `resource_type: notification_template
channel: sms
handle: otp
displayName: OTP
content:
  subject: nope
  body: Code {{ctx(code)}}
`
	dto, err := parseDeclaredTemplate([]byte(badSMS))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := validateDeclaredTemplate(dto); err == nil {
		t.Fatal("expected validation to reject an SMS template with a subject")
	}
}
