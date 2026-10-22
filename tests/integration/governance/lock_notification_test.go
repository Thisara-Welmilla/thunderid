// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package governance

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/suite"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

// notificationSection is the server-config section naming the default email sender.
const notificationSection = "notification"

// LockNotificationTestSuite checks the lock email settings: the templates the bootstrap stores in the
// accountAccess section, the values that section and the notification section refuse, and a
// declarative notification section naming a declarative sender.
type LockNotificationTestSuite struct {
	suite.Suite
	originalNotification  json.RawMessage
	originalAccountAccess json.RawMessage
}

func TestLockNotificationTestSuite(t *testing.T) {
	suite.Run(t, new(LockNotificationTestSuite))
}

// shippedLockEmail is the lock email templates the bootstrap stores in the accountAccess section.
var shippedLockEmail = map[string]interface{}{
	"templates": map[string]interface{}{
		"temporary": "authentication-method-locked",
		"permanent": "authentication-method-locked-permanent",
		"account": map[string]interface{}{
			"temporary": "account-locked",
			"permanent": "account-locked-permanent",
		},
	},
}

func (ts *LockNotificationTestSuite) SetupSuite() {
	var err error
	ts.originalNotification, err = testutils.GetWritableServerConfig(notificationSection)
	ts.Require().NoError(err, "failed to read the notification section")
	ts.originalAccountAccess, err = testutils.GetWritableServerConfig(accountAccessSection)
	ts.Require().NoError(err, "failed to read the accountAccess section")
}

func (ts *LockNotificationTestSuite) TearDownSuite() {
	if ts.originalAccountAccess != nil {
		if err := testutils.PutWritableServerConfig(accountAccessSection, ts.originalAccountAccess); err != nil {
			ts.T().Errorf("teardown: failed to restore the accountAccess section: %v", err)
		}
	}
	if ts.originalNotification != nil {
		if err := testutils.PutWritableServerConfig(notificationSection, ts.originalNotification); err != nil {
			ts.T().Errorf("teardown: failed to restore the notification section: %v", err)
		}
	}
}

// The bootstrap stores the lock email templates in the section's writable layer, since they are not
// part of the deployment configuration.
func (ts *LockNotificationTestSuite) TestTheBootstrapStoresTheLockEmailTemplates() {
	var section struct {
		User struct {
			Notifications struct {
				OnLock struct {
					Email map[string]interface{} `json:"email"`
				} `json:"onLock"`
			} `json:"notifications"`
		} `json:"user"`
	}
	ts.Require().NoError(json.Unmarshal(ts.originalAccountAccess, &section))

	email := section.User.Notifications.OnLock.Email
	delete(email, "enabled")
	ts.Equal(shippedLockEmail, email)
}

// The section refuses a template that is not a handle and a method that is not lockable.
func (ts *LockNotificationTestSuite) TestAnInvalidLockTemplateIsRefused() {
	for _, email := range []string{
		`{"templates":{"temporary":"Not A Handle"}}`,
		`{"templates":{"methods":{"passkey":{"temporary":"authentication-method-locked"}}}}`,
	} {
		status, body := putSection(ts.T(), accountAccessSection,
			`{"user":{"notifications":{"onLock":{"email":`+email+`}}}}`)
		ts.Equal(http.StatusBadRequest, status, "%s must be refused: %s", email, body)
		ts.Contains(body, "SCF-1003", "%s must be refused as an invalid value", email)
	}
}

// The recipient is not configurable, so the section refuses a recipient attribute.
func (ts *LockNotificationTestSuite) TestARecipientAttributeIsRefused() {
	status, body := putSection(ts.T(), accountAccessSection,
		`{"user":{"notifications":{"onLock":{"email":{"recipientAttribute":"email"}}}}}`)
	ts.Equal(http.StatusBadRequest, status, "a recipient attribute must be refused: %s", body)
	ts.Contains(body, "SCF-1003", "a recipient attribute must be refused as an unknown field")
}

// Sender resolution belongs to delivery, so the section accepts an unresolved sender.
func (ts *LockNotificationTestSuite) TestAnUnknownSenderIsStoredWithoutResolution() {
	original, err := testutils.GetWritableServerConfig(notificationSection)
	ts.Require().NoError(err)
	ts.T().Cleanup(func() {
		ts.Require().NoError(testutils.PutWritableServerConfig(notificationSection, original))
	})
	const value = `{"defaultEmailSenderId":"00000000-0000-0000-0000-000000000000"}`
	status, body := putSection(ts.T(), notificationSection, value)
	ts.Require().Equal(http.StatusOK, status, "sender resolution must wait until delivery: %s", body)
	stored, err := testutils.GetWritableServerConfig(notificationSection)
	ts.Require().NoError(err)
	ts.JSONEq(value, string(stored))
}

// The section names a sender first, since a read decodes the stored layer and would hide a stored
// unknown key.
func (ts *LockNotificationTestSuite) TestAnUnknownNotificationSettingIsRefusedAndPersistsNothing() {
	senderID, err := testutils.CreateSMTPEmailProvider("Notification Setting Test Provider", "localhost", 2525,
		"noreply@thunderid.test")
	ts.Require().NoError(err, "failed to create the email provider")
	defer func() {
		ts.Assert().NoError(testutils.DeleteNotificationSender(senderID), "failed to delete the email provider")
	}()
	ts.Require().NoError(testutils.PutWritableServerConfig(notificationSection,
		[]byte(fmt.Sprintf(`{"defaultEmailSenderId":%q}`, senderID))), "the section must accept an email sender")
	defer func() {
		ts.Assert().NoError(testutils.PutWritableServerConfig(notificationSection, []byte(`{}`)),
			"failed to clear the default sender")
	}()
	before, err := testutils.GetWritableServerConfig(notificationSection)
	ts.Require().NoError(err)

	status, body := putSection(ts.T(), notificationSection, `{"defaultEmailSender":"`+senderID+`"}`)
	ts.Equal(http.StatusBadRequest, status, "a misspelled key must be refused: %s", body)
	ts.Contains(body, "SCF-1003", "a misspelled key must be refused as an invalid value")

	after, err := testutils.GetWritableServerConfig(notificationSection)
	ts.Require().NoError(err)
	ts.JSONEq(string(before), string(after), "a refused write must leave the sender named")
}

// declarativeSenderID is the email sender declarativeSenderResources declares.
const declarativeSenderID = "governance-declarative-email-sender"

// declarativeSenderResources declares an email sender and a notification section naming it.
const declarativeSenderResources = `resource_type: connection
id: ` + declarativeSenderID + `
type: email-smtp
name: Governance Declarative Email Sender
host: localhost
port: 2525
fromAddress: noreply@thunderid.test
---
resource_type: server_config
name: notification
value:
  defaultEmailSenderId: ` + declarativeSenderID + `
`

// Runs in declarative mode, since outside it the notification service reads no declarative sender.
func (ts *LockNotificationTestSuite) TestADeclarativeSectionCanNameADeclarativeSender() {
	dir := ts.T().TempDir()
	deployment, err := os.ReadFile(filepath.Join(testutils.GetExtractedProductHome(), "deployment.yaml"))
	ts.Require().NoError(err)
	snapshot := filepath.Join(dir, "deployment.yaml")
	ts.Require().NoError(os.WriteFile(snapshot, deployment, 0o600))
	resourcesPath := filepath.Join(dir, "resources.yaml")
	ts.Require().NoError(os.WriteFile(resourcesPath, []byte(declarativeSenderResources), 0o600))
	defer func() {
		ts.Assert().NoError(testutils.UpdateDeploymentConfig(snapshot), "the deployment must be put back")
		ts.Assert().NoError(testutils.RestartServer(), "the server must start again on the deployment it had")
		ts.Assert().NoError(testutils.ObtainAdminAccessToken())
	}()

	ts.Require().NoError(testutils.PatchDeploymentConfig(map[string]interface{}{
		"declarative_resources": map[string]interface{}{"enabled": true},
	}))
	ts.Require().NoError(testutils.RestartServerWithResourcesFile(resourcesPath),
		"a declarative section naming a declarative sender must not stop the server starting")
	ts.Require().NoError(testutils.ObtainAdminAccessToken())

	var layers struct {
		ReadOnly struct {
			DefaultEmailSenderID string `json:"defaultEmailSenderId"`
		} `json:"readOnly"`
		Merged struct {
			DefaultEmailSenderID string `json:"defaultEmailSenderId"`
		} `json:"merged"`
	}
	body := getManagement(ts.T(), "/server-config/"+notificationSection)
	ts.Require().NoError(json.Unmarshal(body, &layers), string(body))
	ts.Equal(declarativeSenderID, layers.ReadOnly.DefaultEmailSenderID, "the declarative layer must name the sender")
	ts.Equal(declarativeSenderID, layers.Merged.DefaultEmailSenderID, "the declarative sender must be in force")

	status, response := putSection(ts.T(), notificationSection, `{}`)
	ts.Equal(http.StatusBadRequest, status, "a write over a declarative sender must be refused: %s", response)
	ts.Contains(response, "SCF-1003", "a write over a declarative sender must be refused as an invalid value")
}
