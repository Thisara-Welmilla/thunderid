// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package importer

import (
	"context"
	"fmt"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/thunder-id/thunderid/internal/notificationtemplate"
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
)

type fakeNotifTemplateAdapter struct {
	createErr        *tidcommon.ServiceError
	existingByHandle map[string]string
	createdChannels  []notificationtemplate.ChannelType
	created          []notificationtemplate.CreateTemplateRequest
	updatedIDs       []string
	updated          []notificationtemplate.UpdateTemplateRequest
}

func (f *fakeNotifTemplateAdapter) CreateTemplate(_ context.Context, channel notificationtemplate.ChannelType,
	req notificationtemplate.CreateTemplateRequest) (*notificationtemplate.Template, *tidcommon.ServiceError) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.createdChannels = append(f.createdChannels, channel)
	f.created = append(f.created, req)
	return &notificationtemplate.Template{ID: "new-" + req.Handle, Handle: req.Handle}, nil
}

func (f *fakeNotifTemplateAdapter) UpdateTemplate(_ context.Context, _ notificationtemplate.ChannelType, id string,
	req notificationtemplate.UpdateTemplateRequest) (*notificationtemplate.Template, *tidcommon.ServiceError) {
	f.updatedIDs = append(f.updatedIDs, id)
	f.updated = append(f.updated, req)
	return &notificationtemplate.Template{ID: id, Handle: req.DisplayName}, nil
}

// ListTemplates paginates over existingByHandle in a deterministic (handle-sorted) order, respecting
// limit/offset and reporting TotalResults, so the importer's paging lookup can be exercised.
func (f *fakeNotifTemplateAdapter) ListTemplates(_ context.Context, _ notificationtemplate.ChannelType,
	limit, offset int) (*notificationtemplate.TemplateListResponse, *tidcommon.ServiceError) {
	handles := make([]string, 0, len(f.existingByHandle))
	for h := range f.existingByHandle {
		handles = append(handles, h)
	}
	sort.Strings(handles)

	all := make([]notificationtemplate.TemplateSummary, 0, len(handles))
	for _, h := range handles {
		all = append(all, notificationtemplate.TemplateSummary{ID: f.existingByHandle[h], Handle: h})
	}

	resp := &notificationtemplate.TemplateListResponse{TotalResults: len(all)}
	if offset < len(all) {
		end := offset + limit
		if end > len(all) {
			end = len(all)
		}
		resp.Templates = all[offset:end]
	}
	return resp, nil
}

const emailTemplateDoc = `
resource_type: notification_template
channel: email
handle: user-invite
displayName: User Invitation Email
description: Invite.
content:
  subject: Welcome
  body: "<p>{{ctx(inviteLink)}}</p>"
`

func parseFirstDoc(t *testing.T, content string) parsedDocument {
	t.Helper()
	docs, err := parseDocuments(content)
	assert.NoError(t, err)
	assert.Len(t, docs, 1)
	return docs[0]
}

func TestImportNotificationTemplate_Create(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{}
	svc := &importService{notifTemplateService: fake}

	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{}, false)

	assert.Equal(t, statusSuccess, outcome.Status)
	assert.Equal(t, operationCreate, outcome.Operation)
	assert.Len(t, fake.created, 1)
	assert.Equal(t, notificationtemplate.ChannelTypeEmail, fake.createdChannels[0])
	assert.Equal(t, "user-invite", fake.created[0].Handle)
	assert.Equal(t, "Welcome", fake.created[0].Content.Subject)
	assert.Equal(t, "<p>{{ctx(inviteLink)}}</p>", fake.created[0].Content.Body)
	assert.Empty(t, fake.updated)
}

func TestImportNotificationTemplate_UpsertUpdatesExisting(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{
		createErr:        &notificationtemplate.ErrorTemplateHandleConflict,
		existingByHandle: map[string]string{"user-invite": "existing-id"},
	}
	svc := &importService{notifTemplateService: fake}

	upsert := true
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{Upsert: &upsert}, false)

	assert.Equal(t, statusSuccess, outcome.Status)
	assert.Equal(t, operationUpdate, outcome.Operation)
	assert.Equal(t, []string{"existing-id"}, fake.updatedIDs)
	assert.Len(t, fake.updated, 1)
	assert.Empty(t, fake.created)
}

func TestImportNotificationTemplate_ConflictWithoutUpsertFails(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{createErr: &notificationtemplate.ErrorTemplateHandleConflict}
	svc := &importService{notifTemplateService: fake}

	upsert := false
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{Upsert: &upsert}, false)

	assert.Equal(t, statusFailed, outcome.Status)
	assert.Empty(t, fake.updated)
}

func TestImportNotificationTemplate_NoAdapter(t *testing.T) {
	svc := &importService{}

	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{}, false)

	assert.Equal(t, statusFailed, outcome.Status)
}

func TestImportNotificationTemplate_DryRunReportsCreateWithoutWriting(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{}
	svc := &importService{notifTemplateService: fake}

	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{}, true)

	assert.Equal(t, statusSuccess, outcome.Status)
	assert.Equal(t, operationCreate, outcome.Operation)
	assert.Empty(t, fake.created)
	assert.Empty(t, fake.updated)
}

func TestImportNotificationTemplate_DryRunReportsUpdateForExisting(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{existingByHandle: map[string]string{"user-invite": "existing-id"}}
	svc := &importService{notifTemplateService: fake}

	upsert := true
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, emailTemplateDoc), &ImportOptions{Upsert: &upsert}, true)

	assert.Equal(t, statusSuccess, outcome.Status)
	assert.Equal(t, operationUpdate, outcome.Operation)
	assert.Empty(t, fake.created)
	assert.Empty(t, fake.updated)
}

func TestImportNotificationTemplate_DryRunValidatesChannel(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{}
	svc := &importService{notifTemplateService: fake}

	doc := `
resource_type: notification_template
channel: carrier-pigeon
handle: user-invite
displayName: Bad Channel
content:
  subject: Welcome
  body: body
`
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, doc), &ImportOptions{}, true)

	assert.Equal(t, statusFailed, outcome.Status)
	assert.Empty(t, fake.created)
}

func TestImportNotificationTemplate_SmsWithSubjectFails(t *testing.T) {
	fake := &fakeNotifTemplateAdapter{}
	svc := &importService{notifTemplateService: fake}

	doc := `
resource_type: notification_template
channel: sms
handle: otp
displayName: SMS OTP
content:
  subject: Not allowed for SMS
  body: Your code is {{ctx(otp)}}
`
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, doc), &ImportOptions{}, false)

	assert.Equal(t, statusFailed, outcome.Status)
	assert.Empty(t, fake.created)
}

func TestImportNotificationTemplate_UpsertFindsHandleOnLaterPage(t *testing.T) {
	// Target handle sorts after a full first page, so it is only found by paging past page one.
	existing := map[string]string{"zz-user-invite": "late-id"}
	for i := 0; i < 150; i++ {
		existing[fmt.Sprintf("a-filler-%03d", i)] = fmt.Sprintf("filler-%03d", i)
	}
	fake := &fakeNotifTemplateAdapter{
		createErr:        &notificationtemplate.ErrorTemplateHandleConflict,
		existingByHandle: existing,
	}
	svc := &importService{notifTemplateService: fake}

	doc := `
resource_type: notification_template
channel: email
handle: zz-user-invite
displayName: Late Page Template
content:
  subject: Welcome
  body: body
`
	upsert := true
	outcome := svc.importNotificationTemplate(
		context.Background(), parseFirstDoc(t, doc), &ImportOptions{Upsert: &upsert}, false)

	assert.Equal(t, statusSuccess, outcome.Status)
	assert.Equal(t, operationUpdate, outcome.Operation)
	assert.Equal(t, []string{"late-id"}, fake.updatedIDs)
}
