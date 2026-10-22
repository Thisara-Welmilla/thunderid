// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package governance

import (
	"bytes"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

// Event types and data keys this file asserts. They mirror the server's event package, which a
// separate module cannot import; the names are the contract an event consumer reads.
const (
	eventServerConfigUpdated      = "SERVER_CONFIG_UPDATED"
	eventServerConfigUpdateFailed = "SERVER_CONFIG_UPDATE_FAILED"

	eventKeySubject    = "sub"
	eventKeyActorSub   = "act_sub"
	eventKeyError      = "error"
	eventKeyConfigName = "config_name"
)

// GovernanceEventsTestSuite checks what an accountAccess write publishes, read back from the
// observability file sink: the operator, the outcome and its error code, and never the written value.
type GovernanceEventsTestSuite struct {
	suite.Suite
	reader   *testutils.EventLogReader
	adminSub string
}

func TestGovernanceEventsTestSuite(t *testing.T) {
	suite.Run(t, new(GovernanceEventsTestSuite))
}

func (ts *GovernanceEventsTestSuite) SetupSuite() {
	t := ts.T()
	logPath := testutils.EventLogPath("governance-events.log")
	t.Cleanup(func() { restoreShippedPolicy(t) })
	require.NoError(t, testutils.PatchDeploymentConfig(testutils.ObservabilityFileSinkPatch(logPath, true)),
		"failed to enable the observability file sink")
	require.NoError(t, testutils.RestartServer(), "failed to restart with observability enabled")
	require.NoError(t, testutils.ObtainAdminAccessToken(), "failed to re-obtain the admin token")

	token, err := testutils.GetAccessToken()
	require.NoError(t, err)
	claims, err := testutils.DecodeJWT(token)
	require.NoError(t, err, "the admin token must be a JWT")
	require.NotEmpty(t, claims.Sub, "the admin token must name its subject")
	ts.adminSub = claims.Sub

	ts.reader = testutils.NewEventLogReader(logPath)
}

// An accountAccess write publishes the operator and the section and never the value; a refused
// write publishes its error code.
func (ts *GovernanceEventsTestSuite) TestASectionWriteIsPublishedWithoutItsValue() {
	previous, err := testutils.GetWritableServerConfig(accountAccessSection)
	ts.Require().NoError(err)
	defer func() {
		restore := []byte(previous)
		if len(bytes.TrimSpace(restore)) == 0 || string(bytes.TrimSpace(restore)) == "null" {
			restore = []byte(`{}`)
		}
		ts.NoError(testutils.PutWritableServerConfig(accountAccessSection, restore),
			"failed to restore the accountAccess section")
	}()
	ts.Require().NoError(ts.reader.Reset())

	const marker = 7364519
	ts.Require().NoError(testutils.PutWritableServerConfig(accountAccessSection,
		[]byte(fmt.Sprintf(`{"user":{"lastLoginResolutionSeconds":%d}}`, marker))))
	updated := ts.awaitEvent(eventServerConfigUpdated, "")
	ts.Equal(accountAccessSection, updated.Str(eventKeyConfigName), "the section must be published")
	ts.Equal(ts.adminSub, updated.Str(eventKeyActorSub), "the operator must be published")
	ts.NotContains(updated.Raw, fmt.Sprint(marker), "the written value must never be published")

	status, body, err := testutils.PutWritableServerConfigWithStatus(accountAccessSection,
		[]byte(`{"user":{"default":{"lockThreshold":2}}}`))
	ts.Require().NoError(err)
	ts.Require().Equal(http.StatusBadRequest, status, "a misspelled key must be refused: %s", body)
	failed := ts.awaitEvent(eventServerConfigUpdateFailed, "")
	ts.Equal(accountAccessSection, failed.Str(eventKeyConfigName))
	ts.Equal("SCF-1003", failed.Str(eventKeyError), "a refused write must publish its error code")
}

// awaitEvent waits for an event of the type, about the subject when one is given.
func (ts *GovernanceEventsTestSuite) awaitEvent(eventType, subject string) testutils.ObservabilityEvent {
	ts.T().Helper()
	evt, err := ts.reader.Await(func(evt testutils.ObservabilityEvent) bool {
		return evt.Type == eventType && (subject == "" || evt.Str(eventKeySubject) == subject)
	})
	ts.Require().NoError(err, "no %s for %q was published", eventType, subject)
	return evt
}
