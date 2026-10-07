// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package executor

import (
	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"

	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"

	"github.com/thunder-id/thunderid/internal/flow/common"
	notifcm "github.com/thunder-id/thunderid/internal/notification/common"
	"github.com/thunder-id/thunderid/internal/notificationtemplate"
	"github.com/thunder-id/thunderid/tests/mocks/flow/coremock"
	"github.com/thunder-id/thunderid/tests/mocks/notification/notificationmock"
)

const testRenderedSMSBody = "Your notification from the system."

// Flow template property values and the handles they normalize to.
const (
	smsSelfRegistrationProperty = "SELF_REGISTRATION"
	smsSelfRegistrationHandle   = "self-registration"
	smsCIBAProperty             = "CIBA_NOTIFICATION"
	smsCIBAHandle               = "ciba-notification"
)

type SMSExecutorTestSuite struct {
	suite.Suite
	mockFlowFactory      *coremock.FlowFactoryInterfaceMock
	mockBaseExecutor     *coremock.ExecutorInterfaceMock
	mockSMSSenderSvc     *notificationmock.NotificationSenderServiceInterfaceMock
	mockTemplateRenderer *notificationTemplateRendererMock
	executor             *smsExecutor
}

func (suite *SMSExecutorTestSuite) SetupTest() {
	suite.mockFlowFactory = coremock.NewFlowFactoryInterfaceMock(suite.T())
	suite.mockBaseExecutor = coremock.NewExecutorInterfaceMock(suite.T())
	suite.mockSMSSenderSvc = notificationmock.NewNotificationSenderServiceInterfaceMock(suite.T())
	suite.mockTemplateRenderer = newNotificationTemplateRendererMock(suite.T())

	suite.mockFlowFactory.On("CreateExecutor",
		ExecutorNameSMSExecutor,
		providers.ExecutorTypeUtility,
		[]providers.Input{
			{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
		},
		[]providers.Input{},
		mock.Anything,
	).Return(suite.mockBaseExecutor)

	suite.executor = newSMSExecutor(suite.mockFlowFactory, suite.mockSMSSenderSvc, suite.mockTemplateRenderer, nil)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_Success() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
	suite.Equal(dataValueTrue, resp.AdditionalData[common.DataSMSSent])
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_RecipientFromRuntimeData() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs:   make(map[string]string),
		RuntimeData: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
	suite.Equal(dataValueTrue, resp.AdditionalData[common.DataSMSSent])
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_UserInputOverridesRuntimeData() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: map[string]string{
			common.AttributeMobileNumber: "+94771111111",
		},
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
	suite.Equal(dataValueTrue, resp.AdditionalData[common.DataSMSSent])
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_CustomPhoneAttribute() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			"phoneNumber": "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeInputs: []providers.Input{
			{Identifier: "phoneNumber", Type: providers.InputTypePhone, Required: true},
		},
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: "phoneNumber", Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
	suite.Equal(dataValueTrue, resp.AdditionalData[common.DataSMSSent])
}

func (suite *SMSExecutorTestSuite) TestExecute_PrerequisiteNotMet_ReturnsFailure() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs:   make(map[string]string),
		RuntimeData:  make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSRecipientMissing.Error.DefaultValue, resp.Error.Error.DefaultValue)
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_MissingRecipient() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs:   make(map[string]string),
		RuntimeData:  make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSRecipientMissing.Error.DefaultValue, resp.Error.Error.DefaultValue)
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_MissingSenderID() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData:    make(map[string]string),
		NodeProperties: map[string]interface{}{},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.Contains(err.Error(), "senderId is not configured")
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_InvalidSenderIDType() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: 123,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.Contains(err.Error(), "senderId is not configured")
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_InvalidPhoneNumber() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "not-a-phone",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSInvalidPhone.Error.DefaultValue, resp.Error.Error.DefaultValue)
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_NilSMSSenderService_ReturnsError() {
	mockBaseExecutor := coremock.NewExecutorInterfaceMock(suite.T())
	mockFactory := coremock.NewFlowFactoryInterfaceMock(suite.T())
	mockFactory.On("CreateExecutor",
		ExecutorNameSMSExecutor,
		providers.ExecutorTypeUtility,
		[]providers.Input{
			{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
		},
		[]providers.Input{},
		mock.Anything,
	).Return(mockBaseExecutor)

	noServiceExecutor := newSMSExecutor(mockFactory, nil, suite.mockTemplateRenderer, nil)

	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
		},
	}

	resp, err := noServiceExecutor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.EqualError(err, "notification sender service is not configured")
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_UserOnboarding_ClientError_ReturnsExecFailure() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		FlowType:     providers.FlowTypeUserOnboarding,
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	clientErr := &tidcommon.ServiceError{
		Type:  tidcommon.ClientErrorType,
		Code:  "MNS-1001",
		Error: tidcommon.I18nMessage{Key: "error.test.sender_not_found", DefaultValue: "Sender not found"},
		ErrorDescription: tidcommon.I18nMessage{
			Key:          "error.test.the_requested_notification_sender_could_not_be_fou",
			DefaultValue: "The requested notification sender could not be found",
		},
	}
	suite.mockSMSSenderSvc.On("Send", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(clientErr)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSProviderNotConfigured.Error.DefaultValue, resp.Error.Error.DefaultValue)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_UserOnboarding_ServerError_ReturnsError() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		FlowType:     providers.FlowTypeUserOnboarding,
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	serverErr := &tidcommon.ServiceError{
		Type: tidcommon.ServerErrorType,
		Code: "MNS-5000",
		ErrorDescription: tidcommon.I18nMessage{
			Key: "error.test.internal_server_error", DefaultValue: "internal server error",
		},
	}
	suite.mockSMSSenderSvc.On("Send", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(serverErr)

	resp, err := suite.executor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.Contains(err.Error(), "SMS send failed")
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_OtherFlow_NotificationError_ReturnsError() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		FlowType:     providers.FlowTypeRegistration,
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	clientErr := &tidcommon.ServiceError{
		Type:  tidcommon.ClientErrorType,
		Code:  "MNS-1001",
		Error: tidcommon.I18nMessage{Key: "error.test.sender_not_found", DefaultValue: "Sender not found"},
		ErrorDescription: tidcommon.I18nMessage{
			Key:          "error.test.the_requested_notification_sender_could_not_be_fou",
			DefaultValue: "The requested notification sender could not be found",
		},
	}
	suite.mockSMSSenderSvc.On("Send", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(clientErr)

	resp, err := suite.executor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.Contains(err.Error(), "SMS send failed")
}

func (suite *SMSExecutorTestSuite) TestExecute_NoSMSTemplateProperty_ReturnsFlowError() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSTemplateMissing.Error.DefaultValue, resp.Error.Error.DefaultValue)
	suite.mockTemplateRenderer.AssertNotCalled(suite.T(), "Resolve",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_EmptySMSTemplateProperty_ReturnsFlowError() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          "",
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecFailure, resp.Status)
	suite.Equal(ErrSMSTemplateMissing.Error.DefaultValue, resp.Error.Error.DefaultValue)
	suite.mockTemplateRenderer.AssertNotCalled(suite.T(), "Resolve",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SMSTemplatePropertySet_UsesCustomHandle() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
	suite.mockTemplateRenderer.AssertCalled(suite.T(), "Resolve",
		mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_TemplateRenderFailure_ReturnsError() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: make(map[string]string),
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsSelfRegistrationProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	renderErr := &tidcommon.ServiceError{Code: "TPL-5000"}
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsSelfRegistrationHandle,
		mock.Anything).
		Return(nil, renderErr)

	resp, err := suite.executor.Execute(ctx)

	suite.Error(err)
	suite.Nil(resp)
	suite.Contains(err.Error(), "failed to render SMS template")
	suite.mockSMSSenderSvc.AssertNotCalled(suite.T(), "Send",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func (suite *SMSExecutorTestSuite) TestExecute_SendMode_TemplateDataIncludesRuntimeData() {
	ctx := &providers.NodeContext{
		ExecutionID:  "test-flow-id",
		ExecutorMode: ExecutorModeSend,
		Application:  providers.Application{Name: "MyApp"},
		UserInputs: map[string]string{
			common.AttributeMobileNumber: "+94714627887",
		},
		RuntimeData: map[string]string{
			common.RuntimeKeyBindingMessage: "Approve sign-in",
		},
		ForwardedData: map[string]interface{}{
			common.ForwardedDataKeyTemplateData: map[string]interface{}{
				"inviteLink": "https://localhost:5190/gate/invite?executionId=test",
			},
		},
		NodeProperties: map[string]interface{}{
			propertyKeyNotificationSenderID: "sender-uuid-001",
			propertyKeySMSTemplate:          smsCIBAProperty,
		},
	}

	suite.mockBaseExecutor.On("GetRequiredInputs", mock.Anything).Return([]providers.Input{
		{Identifier: common.AttributeMobileNumber, Type: providers.InputTypePhone, Required: true},
	}).Maybe()
	suite.mockTemplateRenderer.On("Resolve", mock.Anything, notificationChannelSMS, smsCIBAHandle,
		notificationtemplate.RenderInput{
			Data: map[string]string{
				common.RuntimeKeyBindingMessage: "Approve sign-in",
				"appName":                       "MyApp",
				"inviteLink":                    "https://localhost:5190/gate/invite?executionId=test",
			},
		},
	).Return(&notificationtemplate.ResolvedContent{Body: testRenderedSMSBody}, nil)
	suite.mockSMSSenderSvc.On("Send",
		mock.Anything, mock.Anything, "sender-uuid-001",
		notifcm.NotificationData{Recipient: "+94714627887", Body: testRenderedSMSBody},
	).Return(nil)

	resp, err := suite.executor.Execute(ctx)

	suite.NoError(err)
	suite.Equal(providers.ExecComplete, resp.Status)
}

func TestSMSExecutorSuite(t *testing.T) {
	suite.Run(t, new(SMSExecutorTestSuite))
}
