// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"

	"github.com/thunder-id/thunderid/internal/system/resourcedependency"
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
)

// inlineTransactioner runs the operation directly, mirroring a committed transaction.
type inlineTransactioner struct{}

func (inlineTransactioner) Transact(ctx context.Context, op func(context.Context) error) error {
	return op(ctx)
}

// stubRegistry is a minimal resourcedependency.Registry for delete tests.
type stubRegistry struct {
	resp *resourcedependency.DependenciesResponse
}

func (r *stubRegistry) RegisterProvider(resourcedependency.Provider) {}
func (r *stubRegistry) GetDependencies(context.Context, string, string) (
	*resourcedependency.DependenciesResponse, error) {
	return r.resp, nil
}
func (r *stubRegistry) CascadeDelete(context.Context, string, string) (int, error) { return 0, nil }
func (r *stubRegistry) ValidateReferenceUpdate(context.Context, string, string) *tidcommon.ServiceError {
	return nil
}

type NotificationTemplateServiceTestSuite struct {
	suite.Suite
	mockStore *notificationTemplateStoreInterfaceMock
	svc       NotificationTemplateServiceInterface
	ctx       context.Context
}

func TestNotificationTemplateServiceTestSuite(t *testing.T) {
	suite.Run(t, new(NotificationTemplateServiceTestSuite))
}

func (s *NotificationTemplateServiceTestSuite) SetupTest() {
	s.mockStore = newNotificationTemplateStoreInterfaceMock(s.T())
	s.svc = newNotificationTemplateService(s.mockStore, inlineTransactioner{})
	s.ctx = context.Background()
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_Email() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "otp-verification").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.MatchedBy(func(d templateDAO) bool {
		return d.Handle == "otp-verification" && d.Content.Subject == "s.key" && d.Design != nil
	})).Return(nil)

	tmpl, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle:      "otp-verification",
		DisplayName: "OTP Verification",
		Content:     TemplateContent{Subject: "s.key", Body: "b.key"},
		Design:      &TemplateDesign{ColorScheme: colorSchemeLight},
	})
	s.Require().Nil(err)
	s.Require().NotEmpty(tmpl.ID)
	s.Require().Equal("otp-verification", tmpl.Handle)
	s.Require().Equal("OTP Verification", tmpl.DisplayName)
	s.Require().Equal("s.key", tmpl.Content.Subject)
	s.Require().NotNil(tmpl.Design)
	s.Require().Equal(colorSchemeLight, tmpl.Design.ColorScheme)
	s.Require().Equal(buildSelf(channelEmail, tmpl.ID), tmpl.Self)
}

// TestCreateTemplate_ContentRoundTrip stores realistic content for both channels and confirms the
// service maps the stored DAO back to the API shape verbatim (content is opaque at this layer).
func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_ContentRoundTrip() {
	const emailSubject = "{{t(notification.otp.email.subject)}}"
	const emailBody = "<p>{{t(notification.otp.email.message)}}</p><p>{{ctx(otp)}}</p>" +
		"<span style=\"color:{{design(palette.primary.main)}}\">{{ctx(expiryTime)}}</span>"
	const smsBody = "{{t(notification.otp.sms.message)}} {{ctx(otp)}}"

	s.mockStore.On("IsHandleExists", mock.Anything, mock.Anything, mock.Anything).Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil)
	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, mock.Anything).Return(templateDAO{
		Channel: channelEmail, Handle: "otp-verification",
		Content: TemplateContent{Subject: emailSubject, Body: emailBody},
		Design:  &TemplateDesign{ColorScheme: colorSchemeDark},
	}, nil)
	s.mockStore.On("GetTemplate", mock.Anything, channelSMS, mock.Anything).Return(templateDAO{
		Channel: channelSMS, Handle: "otp-verification",
		Content: TemplateContent{Body: smsBody},
	}, nil)

	email, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle:      "otp-verification",
		DisplayName: "OTP Verification",
		Content:     TemplateContent{Subject: emailSubject, Body: emailBody},
		Design:      &TemplateDesign{ColorScheme: colorSchemeDark},
	})
	s.Require().Nil(err)

	gotEmail, err := s.svc.GetTemplate(s.ctx, channelEmail, email.ID)
	s.Require().Nil(err)
	s.Require().Equal(emailSubject, gotEmail.Content.Subject)
	s.Require().Equal(emailBody, gotEmail.Content.Body)
	s.Require().NotNil(gotEmail.Design)
	s.Require().Equal(colorSchemeDark, gotEmail.Design.ColorScheme)

	sms, err := s.svc.CreateTemplate(s.ctx, channelSMS, CreateTemplateRequest{
		Handle:      "otp-verification",
		DisplayName: "OTP Verification",
		Content:     TemplateContent{Body: smsBody},
	})
	s.Require().Nil(err)

	gotSMS, err := s.svc.GetTemplate(s.ctx, channelSMS, sms.ID)
	s.Require().Nil(err)
	s.Require().Equal(smsBody, gotSMS.Content.Body)
	s.Require().Empty(gotSMS.Content.Subject)
	s.Require().Nil(gotSMS.Design)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_SMSPlainBodySucceeds() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelSMS, "otp-verification").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil)

	tmpl, err := s.svc.CreateTemplate(s.ctx, channelSMS, CreateTemplateRequest{
		Handle:      "otp-verification",
		DisplayName: "OTP Verification",
		Content:     TemplateContent{Body: "b.key"},
	})
	s.Require().Nil(err)
	s.Require().Empty(tmpl.Content.Subject)
	s.Require().Nil(tmpl.Design)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_SMSRejectsEmailOnlyFields() {
	// Both rejections happen in channel validation, before any store call.
	_, err := s.svc.CreateTemplate(s.ctx, channelSMS, CreateTemplateRequest{
		Handle: "otp", DisplayName: "OTP", Content: TemplateContent{Subject: "s.key", Body: "b.key"}})
	s.Require().Equal(ErrorSubjectNotAllowed.Code, err.Code)

	_, err = s.svc.CreateTemplate(s.ctx, channelSMS, CreateTemplateRequest{
		Handle: "otp", DisplayName: "OTP", Content: TemplateContent{Body: "b.key"},
		Design: &TemplateDesign{ColorScheme: colorSchemeDark}})
	s.Require().Equal(ErrorDesignNotAllowed.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_DisplayNameTooLong() {
	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle:      "handle",
		DisplayName: strings.Repeat("a", maxDisplayNameLength+1),
		Content:     TemplateContent{Body: "b"},
	})
	s.Require().Equal(ErrorDisplayNameTooLong.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_DescriptionTooLong() {
	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle:      "handle",
		DisplayName: "OK",
		Description: strings.Repeat("d", maxDescriptionLength+1),
		Content:     TemplateContent{Body: "b"},
	})
	s.Require().Equal(ErrorDescriptionTooLong.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_HandleValidation() {
	// Missing handle.
	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingHandle.Code, err.Code)

	// Not kebab-case (uppercase / spaces).
	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "Not Valid", DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorInvalidHandle.Code, err.Code)

	// Too long.
	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: strings.Repeat("a", maxHandleLength+1), DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorHandleTooLong.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_BlankFieldsRejected() {
	// A whitespace-only displayName is treated as missing.
	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", DisplayName: "   ", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingDisplayName.Code, err.Code)

	// A whitespace-only body is treated as missing.
	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", DisplayName: "n", Content: TemplateContent{Body: "  \t\n "}})
	s.Require().Equal(ErrorMissingBody.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_Validation() {
	_, err := s.svc.CreateTemplate(s.ctx, "push", CreateTemplateRequest{
		Handle: "h", DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorInvalidChannel.Code, err.Code)

	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingDisplayName.Code, err.Code)

	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{Handle: "h", DisplayName: "n"})
	s.Require().Equal(ErrorMissingBody.Code, err.Code)
}

// TestEmailSubjectRequired confirms an email template must carry a subject on both create and update,
// while SMS (which forbids a subject) is unaffected.
func (s *NotificationTemplateServiceTestSuite) TestEmailSubjectRequired() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "h").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil)

	// Create without a subject -> rejected (before store).
	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingSubject.Code, err.Code)

	// A whitespace-only subject is treated as missing (before store).
	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", DisplayName: "n", Content: TemplateContent{Subject: "  \t ", Body: "b"}})
	s.Require().Equal(ErrorMissingSubject.Code, err.Code)

	// With a subject it succeeds.
	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "h", DisplayName: "n", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	// Dropping the subject on update is likewise rejected (before store).
	_, err = s.svc.UpdateTemplate(s.ctx, channelEmail, created.ID, UpdateTemplateRequest{
		DisplayName: "n", Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingSubject.Code, err.Code)
}

// TestCreateTemplate_ConcurrentUniqueViolation simulates the race where the handle pre-check passes
// but the INSERT trips the DB UNIQUE constraint; the driver error must map to the 409 conflict.
func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_ConcurrentUniqueViolation() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "fresh").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(
		errors.New("pq: duplicate key value violates unique constraint " +
			"\"notification_template_deployment_id_channel_handle_key\""))

	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "fresh", DisplayName: "Fresh", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().NotNil(err)
	s.Require().Equal(ErrorTemplateHandleConflict.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestIsUniqueViolation() {
	s.Require().False(isUniqueViolation(nil))
	s.Require().False(isUniqueViolation(errors.New("some other error")))
	s.Require().True(isUniqueViolation(errors.New("UNIQUE constraint failed: NOTIFICATION_TEMPLATE.HANDLE")))
	s.Require().True(isUniqueViolation(fmt.Errorf("wrapped: %w",
		errors.New("pq: duplicate key value violates unique constraint"))))
}

func (s *NotificationTemplateServiceTestSuite) TestCreateTemplate_HandleConflictPerChannel() {
	// Email create succeeds, the second email create with the same handle conflicts, and the same
	// handle on SMS is allowed (uniqueness is per channel).
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "dup").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.MatchedBy(func(d templateDAO) bool {
		return d.Channel == channelEmail
	})).Return(nil).Once()
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "dup").Return(true, nil).Once()
	s.mockStore.On("IsHandleExists", mock.Anything, channelSMS, "dup").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.MatchedBy(func(d templateDAO) bool {
		return d.Channel == channelSMS
	})).Return(nil).Once()

	emailReq := CreateTemplateRequest{
		Handle: "dup", DisplayName: "Dup", Content: TemplateContent{Subject: "s", Body: "b"},
	}
	smsReq := CreateTemplateRequest{Handle: "dup", DisplayName: "Dup", Content: TemplateContent{Body: "b"}}

	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, emailReq)
	s.Require().Nil(err)

	_, err = s.svc.CreateTemplate(s.ctx, channelEmail, emailReq)
	s.Require().Equal(ErrorTemplateHandleConflict.Code, err.Code)

	_, err = s.svc.CreateTemplate(s.ctx, channelSMS, smsReq)
	s.Require().Nil(err)
}

func (s *NotificationTemplateServiceTestSuite) TestUpdateTemplate() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "original").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil).Once()

	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "original", DisplayName: "Original", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, created.ID).Return(templateDAO{
		ID: created.ID, Channel: channelEmail, Handle: "original", DisplayName: "Original",
		Content: TemplateContent{Subject: "s", Body: "b"},
	}, nil).Once()
	s.mockStore.On("UpdateTemplate", mock.Anything, mock.Anything).Return(nil).Once()

	updated, err := s.svc.UpdateTemplate(s.ctx, channelEmail, created.ID, UpdateTemplateRequest{
		DisplayName: "Renamed", Description: "desc", Content: TemplateContent{Subject: "s", Body: "b2"}})
	s.Require().Nil(err)
	// Handle is immutable and preserved on the response.
	s.Require().Equal("original", updated.Handle)
	s.Require().Equal("Renamed", updated.DisplayName)
	s.Require().Equal("desc", updated.Description)
	s.Require().Equal("b2", updated.Content.Body)

	// Updating a missing template -> not found.
	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, "missing").
		Return(templateDAO{}, errTemplateNotFound).Once()
	_, err = s.svc.UpdateTemplate(s.ctx, channelEmail, "missing", UpdateTemplateRequest{
		DisplayName: "x", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Equal(ErrorTemplateNotFound.Code, err.Code)
}

// TestUpdateTemplate_DuplicateDisplayNameAllowed confirms display names are not unique; only handles
// are, and the handle cannot change on update.
func (s *NotificationTemplateServiceTestSuite) TestUpdateTemplate_DuplicateDisplayNameAllowed() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "a").Return(false, nil)
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "b").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil)

	_, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "a", DisplayName: "Shared", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)
	other, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "b", DisplayName: "Other", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, other.ID).Return(templateDAO{
		ID: other.ID, Channel: channelEmail, Handle: "b", DisplayName: "Other",
		Content: TemplateContent{Subject: "s", Body: "b"},
	}, nil).Once()
	s.mockStore.On("UpdateTemplate", mock.Anything, mock.Anything).Return(nil).Once()

	updated, err := s.svc.UpdateTemplate(s.ctx, channelEmail, other.ID, UpdateTemplateRequest{
		DisplayName: "Shared", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)
	s.Require().Equal("Shared", updated.DisplayName)
	s.Require().Equal("b", updated.Handle)
}

func (s *NotificationTemplateServiceTestSuite) TestGetAndList() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "a").Return(false, nil)
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil)

	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "a", DisplayName: "A", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	createdDao := templateDAO{ID: created.ID, Channel: channelEmail, Handle: "a", DisplayName: "A",
		Content: TemplateContent{Subject: "s", Body: "b"}}
	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, created.ID).Return(createdDao, nil)
	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, "missing").Return(templateDAO{}, errTemplateNotFound)
	s.mockStore.On("GetTemplate", mock.Anything, channelSMS, created.ID).Return(templateDAO{}, errTemplateNotFound)
	s.mockStore.On("CountTemplates", mock.Anything, channelEmail).Return(1, nil)
	s.mockStore.On("ListTemplates", mock.Anything, channelEmail, 30, 0).Return([]templateDAO{createdDao}, nil)

	got, err := s.svc.GetTemplate(s.ctx, channelEmail, created.ID)
	s.Require().Nil(err)
	s.Require().Equal(created.ID, got.ID)
	s.Require().Equal("a", got.Handle)

	_, err = s.svc.GetTemplate(s.ctx, channelEmail, "missing")
	s.Require().Equal(ErrorTemplateNotFound.Code, err.Code)

	// A template created for one channel is not visible under another.
	_, err = s.svc.GetTemplate(s.ctx, channelSMS, created.ID)
	s.Require().Equal(ErrorTemplateNotFound.Code, err.Code)

	list, err := s.svc.ListTemplates(s.ctx, channelEmail, 30, 0)
	s.Require().Nil(err)
	s.Require().Equal(1, list.TotalResults)
	s.Require().Equal(1, list.Count)
	s.Require().Equal(1, list.StartIndex)
	s.Require().Len(list.Templates, 1)
	s.Require().Equal(created.ID, list.Templates[0].ID)
	s.Require().Empty(list.Links)
}

func (s *NotificationTemplateServiceTestSuite) TestListTemplates_Pagination() {
	daos := []templateDAO{
		{ID: "a", Channel: channelEmail, Handle: "a", DisplayName: "a", Content: TemplateContent{Body: "b"}},
		{ID: "b", Channel: channelEmail, Handle: "b", DisplayName: "b", Content: TemplateContent{Body: "b"}},
		{ID: "c", Channel: channelEmail, Handle: "c", DisplayName: "c", Content: TemplateContent{Body: "b"}},
	}
	s.mockStore.On("CountTemplates", mock.Anything, channelEmail).Return(3, nil)
	s.mockStore.On("ListTemplates", mock.Anything, channelEmail, 2, 0).Return(daos[:2], nil)
	s.mockStore.On("ListTemplates", mock.Anything, channelEmail, 2, 2).Return(daos[2:], nil)

	// First page of two: total 3, count 2, a next link.
	page, err := s.svc.ListTemplates(s.ctx, channelEmail, 2, 0)
	s.Require().Nil(err)
	s.Require().Equal(3, page.TotalResults)
	s.Require().Equal(2, page.Count)
	s.Require().Equal(1, page.StartIndex)
	s.Require().NotEmpty(page.Links)

	// Second page: remaining one.
	page, err = s.svc.ListTemplates(s.ctx, channelEmail, 2, 2)
	s.Require().Nil(err)
	s.Require().Equal(1, page.Count)
	s.Require().Equal(3, page.StartIndex)
}

func (s *NotificationTemplateServiceTestSuite) TestListTemplates_InvalidPagination() {
	_, err := s.svc.ListTemplates(s.ctx, channelEmail, 0, 0)
	s.Require().Equal(ErrorInvalidLimit.Code, err.Code)

	_, err = s.svc.ListTemplates(s.ctx, channelEmail, 30, -1)
	s.Require().Equal(ErrorInvalidOffset.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestDeleteTemplate() {
	// Idempotent: deleting an absent template succeeds (no dependency registry set).
	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, "missing").
		Return(templateDAO{}, errTemplateNotFound).Once()
	s.Require().Nil(s.svc.DeleteTemplate(s.ctx, channelEmail, "missing"))

	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "a").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil).Once()
	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "a", DisplayName: "A", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, created.ID).Return(templateDAO{
		ID: created.ID, Channel: channelEmail, Handle: "a"}, nil).Once()
	s.mockStore.On("DeleteTemplate", mock.Anything, channelEmail, created.ID).Return(nil).Once()

	s.Require().Nil(s.svc.DeleteTemplate(s.ctx, channelEmail, created.ID))
}

func (s *NotificationTemplateServiceTestSuite) TestDeleteTemplate_BlockedByFlowReference() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "a").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil).Once()
	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "a", DisplayName: "A", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	total := 1
	s.svc.SetDependencyRegistry(&stubRegistry{resp: &resourcedependency.DependenciesResponse{
		TotalResults: &total,
		Usages: []resourcedependency.ResourceDependency{
			{BehaviorOnDelete: resourcedependency.BehaviorRestrict},
		},
	}})

	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, created.ID).Return(templateDAO{
		ID: created.ID, Channel: channelEmail, Handle: "a"}, nil).Once()

	err = s.svc.DeleteTemplate(s.ctx, channelEmail, created.ID)
	s.Require().Equal(ErrorTemplateInUse.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestDeleteTemplate_IncompleteDependencyResponse() {
	s.mockStore.On("IsHandleExists", mock.Anything, channelEmail, "a").Return(false, nil).Once()
	s.mockStore.On("CreateTemplate", mock.Anything, mock.Anything).Return(nil).Once()
	created, err := s.svc.CreateTemplate(s.ctx, channelEmail, CreateTemplateRequest{
		Handle: "a", DisplayName: "A", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Nil(err)

	s.mockStore.On("GetTemplate", mock.Anything, channelEmail, created.ID).Return(templateDAO{
		ID: created.ID, Channel: channelEmail, Handle: "a"}, nil)

	// A nil TotalResults means usage could not be determined; the delete must fail closed.
	s.svc.SetDependencyRegistry(&stubRegistry{resp: &resourcedependency.DependenciesResponse{}})
	delErr := s.svc.DeleteTemplate(s.ctx, channelEmail, created.ID)
	s.Require().NotNil(delErr)
	s.Require().Equal(tidcommon.InternalServerError.Code, delErr.Code)

	// A nil response is likewise treated as a failure.
	s.svc.SetDependencyRegistry(&stubRegistry{resp: nil})
	delErr = s.svc.DeleteTemplate(s.ctx, channelEmail, created.ID)
	s.Require().NotNil(delErr)
	s.Require().Equal(tidcommon.InternalServerError.Code, delErr.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestUpdateTemplate_UnhappyPaths() {
	valid := UpdateTemplateRequest{DisplayName: "n", Content: TemplateContent{Body: "b"}}

	// Invalid channel and empty id are rejected before any store lookup.
	_, err := s.svc.UpdateTemplate(s.ctx, "push", "id", valid)
	s.Require().Equal(ErrorInvalidChannel.Code, err.Code)

	_, err = s.svc.UpdateTemplate(s.ctx, channelEmail, "", valid)
	s.Require().Equal(ErrorInvalidTemplateID.Code, err.Code)

	// Field validation applies on update too, regardless of whether the template exists.
	_, err = s.svc.UpdateTemplate(s.ctx, channelEmail, "id", UpdateTemplateRequest{Content: TemplateContent{Body: "b"}})
	s.Require().Equal(ErrorMissingDisplayName.Code, err.Code)

	_, err = s.svc.UpdateTemplate(s.ctx, channelEmail, "id", UpdateTemplateRequest{DisplayName: "n"})
	s.Require().Equal(ErrorMissingBody.Code, err.Code)

	_, err = s.svc.UpdateTemplate(s.ctx, channelSMS, "id", UpdateTemplateRequest{
		DisplayName: "n", Content: TemplateContent{Subject: "s", Body: "b"}})
	s.Require().Equal(ErrorSubjectNotAllowed.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestGetTemplate_UnhappyPaths() {
	_, err := s.svc.GetTemplate(s.ctx, "push", "id")
	s.Require().Equal(ErrorInvalidChannel.Code, err.Code)

	_, err = s.svc.GetTemplate(s.ctx, channelEmail, "")
	s.Require().Equal(ErrorInvalidTemplateID.Code, err.Code)
}

func (s *NotificationTemplateServiceTestSuite) TestDeleteTemplate_UnhappyPaths() {
	err := s.svc.DeleteTemplate(s.ctx, "push", "id")
	s.Require().Equal(ErrorInvalidChannel.Code, err.Code)

	err = s.svc.DeleteTemplate(s.ctx, channelEmail, "")
	s.Require().Equal(ErrorInvalidTemplateID.Code, err.Code)
}
