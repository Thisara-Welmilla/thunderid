// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package federated

import (
	"fmt"
	"io"
	"net/http"

	"github.com/thunder-id/thunderid/tests/integration/flow/common"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

/*
Users federated before links were recorded hold their subject only in the schema attribute sub. A
sign-in with no recorded link migrates such a user: the link is recorded at the connection presenting
the subject and the attribute is dropped. Every holder is migrated, whatever else it signs in with, as a
sign-in matched sub before links were recorded.
*/

// legacyUser creates a user the way federated provisioning did before links: the subject in sub.
func (s *FederatedMappingSuite) legacyUser(sub string, extra map[string]interface{}) string {
	s.T().Helper()
	email := sub + "@example.com"
	attributes := map[string]interface{}{"username": email, "email": email, "sub": sub}
	for key, value := range extra {
		attributes[key] = value
	}
	return s.createLocalUser(attributes)
}

func (s *FederatedMappingSuite) userAttributes(userID string) map[string]interface{} {
	s.T().Helper()
	resp, err := testutils.GetHTTPClient().Get(fmt.Sprintf("%s/users/%s", testutils.TestServerURL, userID))
	s.Require().NoError(err)
	defer func() { _ = resp.Body.Close() }()
	s.Require().Equal(http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	s.Require().NoError(err)
	var user testutils.User
	s.Require().NoError(jsonUnmarshal(body, &user))
	attrs, err := testutils.GetUserAttributes(user)
	s.Require().NoError(err)
	return attrs
}

func (s *FederatedMappingSuite) TestLegacySubjectMigratesToRecordedLink() {
	user := s.baseUser(s.nextSubject())
	legacyID := s.legacyUser(user.Sub, nil)

	status, response, _ := s.authenticateDirect(mapping(fedPersonType.Handle), user)
	s.Require().Equal(http.StatusOK, status, "the legacy user should sign in through the fallback")
	s.Equal(legacyID, response.ID)
	s.NotContains(s.userAttributes(legacyID), "sub", "the migrated user should no longer hold sub")

	// With sub gone, only the recorded link can resolve the identity now.
	status, response, _ = s.authenticateDirectVia(s.idpID, user.Sub)
	s.Require().Equal(http.StatusOK, status, "the recorded link should resolve the migrated user")
	s.Equal(legacyID, response.ID)
}

// A user who can sign in another way is migrated too: without account linking attributes on the
// connection, the flow would have no way to link it.
func (s *FederatedMappingSuite) TestLegacySubjectMigratesUserWithCredentials() {
	user := s.baseUser(s.nextSubject())
	userID := s.legacyUser(user.Sub, map[string]interface{}{"password": linkPassword})

	status, response, _ := s.authenticateDirect(mapping(fedPersonType.Handle), user)
	s.Require().Equal(http.StatusOK, status, "a legacy user with a password should sign in through the fallback")
	s.Equal(userID, response.ID)
	s.NotContains(s.userAttributes(userID), "sub", "the migrated user should no longer hold sub")
}

// requireSignedInAs asserts a flow step completed with an assertion issued for userID.
func (s *FederatedMappingSuite) requireSignedInAs(step *common.FlowStep, err error, userID, msg string) {
	s.T().Helper()
	s.Require().NoError(err, msg)
	s.Require().Equal("COMPLETE", step.FlowStatus, "%s, got %+v", msg, step)
	claims, err := testutils.DecodeJWT(step.Assertion)
	s.Require().NoError(err, "failed to decode the assertion")
	s.Equal(userID, claims.Sub, msg)
}

// The fallback runs inside the authentication flow too, so the flow signs the legacy user in rather
// than treating the identity as new.
func (s *FederatedMappingSuite) TestLegacySubjectMigratesThroughAuthenticationFlow() {
	user := s.baseUser(s.nextSubject())
	legacyID := s.legacyUser(user.Sub, nil)

	step, err := s.authenticate(s.authAppID, mapping(fedPersonType.Handle), user)
	s.requireSignedInAs(step, err, legacyID, "the flow should sign the legacy user in")
	s.NotContains(s.userAttributes(legacyID), "sub", "the migrated user should no longer hold sub")

	step, err = s.authenticateFlow(s.authAppID, user.Sub)
	s.requireSignedInAs(step, err, legacyID, "the recorded link should resolve the migrated user")
}

// Several legacy users holding one subject are all migrated, whether or not they hold credentials, and
// the sign-in asks which to continue with, as for an identity linked to several users.
func (s *FederatedMappingSuite) TestLegacySubjectHeldBySeveralUsersOffersPicker() {
	user := s.baseUser(s.nextSubject())
	firstName := "first-" + user.Sub
	firstID := s.legacyUser(user.Sub,
		map[string]interface{}{"username": firstName, "email": firstName + "@example.com"})
	secondName := "second-" + user.Sub
	secondID := s.legacyUser(user.Sub, map[string]interface{}{
		"username": secondName, "email": secondName + "@example.com", "password": linkPassword,
	})

	verifyFlowID := s.createVerifyFlow(common.VerifyPasswordFlow("verify_flow_federated-legacy-picker"))
	appID := s.createScenarioApp(fedLinkResolvingFlow(s.idpID, verifyFlowID), "federated-legacy-picker")
	s.applyConfig(mapping(fedPersonType.Handle))
	s.mockOIDC.AddUser(user)

	pick, err := s.authenticateFlow(appID, user.Sub)
	s.Require().NoError(err, "the identity held by two legacy users should reach the picker")
	s.Require().Equal("INCOMPLETE", pick.FlowStatus, "two claimed users should be picked between, got %+v", pick)
	s.Empty(pick.Assertion, "no assertion may be issued before the account is picked")
	s.Require().True(common.HasInput(pick.Data.Inputs, "username"),
		"the users differ on username, so it should be offered, got %+v", pick.Data.Inputs)
	s.NotContains(s.userAttributes(firstID), "sub", "every holder should be migrated")
	s.NotContains(s.userAttributes(secondID), "sub", "every holder should be migrated")

	picked, err := common.CompleteFlow(pick.ExecutionID, map[string]string{"username": secondName}, "action_pick",
		pick.ChallengeToken)
	s.requireSignedInAs(picked, err, secondID, "the picked account should sign in")
}

// The link is recorded at the connection that presented the subject first. Another connection
// presenting the same subject has no link and no legacy holder left to claim.
func (s *FederatedMappingSuite) TestLegacySubjectStaysWithFirstConnection() {
	user := s.baseUser(s.nextSubject())
	legacyID := s.legacyUser(user.Sub, nil)

	status, response, _ := s.authenticateDirect(mapping(fedPersonType.Handle), user)
	s.Require().Equal(http.StatusOK, status, "the legacy user should sign in through the fallback")
	s.Require().Equal(legacyID, response.ID)

	s.mockOAuth.AddUser(&testutils.OAuthUserInfo{Sub: user.Sub, Email: user.Email, Name: "OAuth User"})
	s.applyConfigTo("oauth", s.oauthIDPID, mapping(fedPersonType.Handle, pair("email", "email")))
	status, response, code := s.authenticateDirectVia(s.oauthIDPID, user.Sub)
	s.Empty(response.ID, "another connection must not resolve to the migrated user")
	s.Equal(http.StatusBadRequest, status)
	s.Equal("AUTHN-FED-1001", code, "the identity should be reported as unlinked")
}
