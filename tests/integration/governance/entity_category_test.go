// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package governance

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

const (
	categoryResourceIdentifier = "https://governance-category.example.com"
	categoryRedirectURI        = "https://localhost:3000/callback"
	tokenExchangeGrant         = "urn:ietf:params:oauth:grant-type:token-exchange"
)

// EntityCategoryTestSuite checks how a suspension treats agents and applications: the hold applies to
// them, revokes the tokens they hold, and unsuspending lands them on ACTIVE. Agents live in the OU the
// shared `default` agent type points at, so the type is not repointed.
type EntityCategoryTestSuite struct {
	suite.Suite
	users      *userFixture
	agentOUID  string
	authFlowID string
}

func TestEntityCategoryTestSuite(t *testing.T) {
	suite.Run(t, new(EntityCategoryTestSuite))
}

func (ts *EntityCategoryTestSuite) SetupSuite() {
	ts.users = newUserFixture(ts.T(), "category", testutils.UserType{Schema: credentialsSchema(nil)})

	// Read the shared agent type rather than repointing it; agents must live in the OU of their type.
	agentType, err := testutils.SnapshotAgentType()
	ts.Require().NoError(err, "failed to read the default agent type")
	ts.agentOUID = agentType.OUID

	authFlowID, err := testutils.CreateFlow(passwordSignInFlow("Governance Entity Category Test Auth Flow",
		"governance-entity-category-auth", "AUTHENTICATION"))
	ts.Require().NoError(err, "failed to create the authentication flow")
	ts.authFlowID = authFlowID
	cleanupFlow(ts.T(), authFlowID)

	resourceServerID, err := testutils.CreateResourceServerWithActions(testutils.ResourceServer{
		Name:        "Governance Category Resource Server",
		Description: "Resource server the category acceptance tests bind their tokens to",
		Identifier:  categoryResourceIdentifier,
		OUID:        ts.users.ouID,
	}, []testutils.Action{})
	ts.Require().NoError(err, "failed to create the resource server")
	t := ts.T()
	t.Cleanup(func() {
		if err := testutils.DeleteResourceServerWithChildren(resourceServerID); err != nil {
			t.Logf("teardown: failed to delete resource server: %v", err)
		}
	})
}

// An administrative hold reaches an agent, its read carries the hold's details, the token it held is
// revoked, and the release lands on ACTIVE rather than on the lock a user's release leaves.
func (ts *EntityCategoryTestSuite) TestAnAdministrativeHoldAppliesToAnAgent() {
	agentID, clientID, clientSecret := ts.newAgent("hold")
	_, introspectorID, introspectorSecret := ts.newApplication("agent_introspector")

	held := ts.issuedToken(clientID, clientSecret, "the agent must be able to obtain a token before the hold")
	ts.Require().True(tokenActive(ts.T(), held, introspectorID, introspectorSecret),
		"the agent's token must be active before the hold")

	runAdministrationFlowAs(ts.T(), adminToken(ts.T()), agentSuspendFlowHandle, map[string]string{
		subjectInput:      agentID,
		operatorNoteInput: "Agent key reported leaked",
	})

	status := readEntityStatus(ts.T(), agentCollection, agentID)
	ts.Equal("SUSPENDED", status.Value, "a management read must report the hold on an agent")
	ts.Require().NotNil(status.Details, "an agent read must carry the suspension's details")
	ts.Equal("ADMINISTRATIVE_SUSPENSION", status.Details.Reason)
	cutoffBound, err := time.Parse(time.RFC3339Nano, status.Details.Since)
	ts.Require().NoError(err, "the read must carry when the hold was placed")
	ts.Equal("Agent key reported leaked", status.Details.OperatorNote,
		"the operator's note must reach an agent's management read")
	ts.False(tokenActive(ts.T(), held, introspectorID, introspectorSecret),
		"a token the agent held before the suspension must be refused")

	runAdministrationFlow(ts.T(), agentUnsuspendFlowHandle, agentID)

	released := readEntityStatus(ts.T(), agentCollection, agentID)
	ts.Equal("ACTIVE", released.Value, "unsuspending an agent must land on ACTIVE, not on a further hold")
	ts.Empty(released.lockedMethods(), "an agent's release must leave no lock")
	ts.False(tokenActive(ts.T(), held, introspectorID, introspectorSecret),
		"the release must not revive the token the suspension revoked")
	waitPastTheCutoff(cutoffBound)
	fresh := ts.issuedToken(clientID, clientSecret,
		"an unsuspended agent must be usable again without a second operator action")
	ts.True(tokenActive(ts.T(), fresh, introspectorID, introspectorSecret),
		"a token issued after the release and the cutoff must be usable")
}

// An agent acting as a client is contained too. A token the agent's client obtained by exchanging
// an application's token names the application in `sub`, so only the agent's client criterion reaches
// it; the application's own token, which the agent did not obtain, stays usable.
func (ts *EntityCategoryTestSuite) TestSuspendingAnAgentRevokesTheTokensItsClientObtained() {
	agentID, agentClientID, agentSecret := ts.newAgent("as_client", tokenExchangeGrant)
	appID, appClientID, appSecret := ts.newApplication("exchange_subject")
	_, introspectorID, introspectorSecret := ts.newApplication("exchange_introspector")

	subjectToken := ts.issuedToken(appClientID, appSecret, "the application must obtain the token the agent exchanges")
	exchanged := exchangeAccessToken(ts.T(), agentClientID, agentSecret, subjectToken)
	ts.Require().Equal(http.StatusOK, exchanged.StatusCode,
		"the agent's client must be able to exchange the token first: %s", exchanged.Body)
	claims, err := testutils.DecodeJWTPayloadMap(exchanged.Token.AccessToken)
	ts.Require().NoError(err)
	ts.Require().Equal(appID, claims["sub"], "the exchanged token must name the application, not the agent")
	ts.Require().True(tokenActive(ts.T(), exchanged.Token.AccessToken, introspectorID, introspectorSecret),
		"the exchanged token must be active before the hold")

	runAdministrationFlow(ts.T(), agentSuspendFlowHandle, agentID)

	ts.False(tokenActive(ts.T(), exchanged.Token.AccessToken, introspectorID, introspectorSecret),
		"a token the agent's client obtained for another subject must be revoked with the agent")
	ts.True(tokenActive(ts.T(), subjectToken, introspectorID, introspectorSecret),
		"the application's own token is not the agent's and must survive")
}

// An administrative hold reaches an application acting on its own behalf, and its release lands on
// ACTIVE. An application read exposes only the status value, even when the suspension carried a note.
func (ts *EntityCategoryTestSuite) TestAnAdministrativeHoldAppliesToAnApplication() {
	appID, _, _ := ts.newApplication("hold")
	ts.Require().Equal("ACTIVE", readEntityStatus(ts.T(), applicationCollection, appID).Value,
		"precondition: the application starts active")

	runAdministrationFlowAs(ts.T(), adminToken(ts.T()), applicationSuspendFlowHandle, map[string]string{
		subjectInput:      appID,
		operatorNoteInput: "Client secret found in a public repository",
	})

	status := readEntityStatus(ts.T(), applicationCollection, appID)
	ts.Equal("SUSPENDED", status.Value, "a management read must report the hold on an application")
	ts.Nil(status.Details, "an application's status must omit suspension details")
	body := string(getManagement(ts.T(), "/"+applicationCollection+"/"+appID))
	ts.NotContains(body, "operatorNote", "an application read must never carry the operator note")
	ts.NotContains(body, "Client secret found", "an application read must never carry the operator note")

	runAdministrationFlow(ts.T(), applicationUnsuspendFlowHandle, appID)

	ts.Equal("ACTIVE", readEntityStatus(ts.T(), applicationCollection, appID).Value,
		"unsuspending an application must land on ACTIVE")
}

// newAgent creates one agent with a client-credentials profile, plus any extra grants, in the OU its
// type belongs to.
func (ts *EntityCategoryTestSuite) newAgent(name string, extraGrants ...string) (
	agentID, clientID, clientSecret string) {
	ts.T().Helper()

	clientID = fmt.Sprintf("governance_agent_%s_%s", name, ts.users.suffix)
	clientSecret = "Agent-Secret-" + name + "1!"

	agentID, err := testutils.CreateAgent(testutils.Agent{
		OUID:       ts.agentOUID,
		Type:       "default",
		Attributes: map[string]interface{}{"name": fmt.Sprintf("governance-category-%s-%s", name, ts.users.suffix)},
		AuthFlowID: ts.authFlowID,
		InboundAuthConfig: []testutils.AgentInboundAuthConfig{
			{
				Type: "oauth2",
				Config: &testutils.AgentOAuthConfig{
					ClientID:                clientID,
					ClientSecret:            clientSecret,
					GrantTypes:              append([]string{"client_credentials"}, extraGrants...),
					TokenEndpointAuthMethod: "client_secret_basic",
				},
			},
		},
	})
	ts.Require().NoError(err, "failed to create the test agent")
	t := ts.T()
	t.Cleanup(func() {
		if err := testutils.DeleteAgent(agentID); err != nil {
			t.Logf("teardown: failed to delete agent %s: %v", agentID, err)
		}
	})
	return agentID, clientID, clientSecret
}

// newApplication creates one application with a client-credentials profile.
func (ts *EntityCategoryTestSuite) newApplication(name string) (appID, clientID, clientSecret string) {
	ts.T().Helper()

	clientID = fmt.Sprintf("governance_app_%s_%s", name, ts.users.suffix)
	clientSecret = "App-Secret-" + name + "1!"

	appID, err := testutils.CreateApplication(testutils.Application{
		OUID:             ts.users.ouID,
		Name:             fmt.Sprintf("Governance Category %s %s", name, ts.users.suffix),
		Description:      "Application the entity category acceptance tests drive",
		AllowedUserTypes: []string{ts.users.userType},
		InboundAuthConfig: []map[string]interface{}{{
			"type": "oauth2",
			"config": map[string]interface{}{
				"clientId":                clientID,
				"clientSecret":            clientSecret,
				"redirectUris":            []string{categoryRedirectURI},
				"grantTypes":              []string{"client_credentials"},
				"tokenEndpointAuthMethod": "client_secret_basic",
			},
		}},
	})
	ts.Require().NoError(err, "failed to create the test application")
	cleanupApplication(ts.T(), appID)
	return appID, clientID, clientSecret
}

// clientCredentials requests the client's own token bound to the suite's resource server.
func (ts *EntityCategoryTestSuite) clientCredentials(clientID, clientSecret string) *testutils.TokenHTTPResult {
	ts.T().Helper()
	return clientCredentials(ts.T(), clientID, clientSecret, categoryResourceIdentifier)
}

// issuedToken requires the client to obtain its own token and returns it.
func (ts *EntityCategoryTestSuite) issuedToken(clientID, clientSecret, msg string) string {
	ts.T().Helper()
	result := ts.clientCredentials(clientID, clientSecret)
	ts.Require().Equal(http.StatusOK, result.StatusCode, "%s: %s", msg, result.Body)
	ts.Require().NotEmpty(result.Token.AccessToken, msg)
	return result.Token.AccessToken
}
