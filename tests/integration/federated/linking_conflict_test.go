// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package federated

import (
	"github.com/thunder-id/thunderid/tests/integration/flow/common"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

/*
One federated identity, two sign-ins.

A subject is linked to at most one user. A sign-in checks for a link when it starts, so two sign-ins
for the same subject that both pause before writing would each find it free. These scenarios pause one
at a prompt, let the other record the link, then resume the first: its write is the one the uniqueness
rule refuses, and the user the other sign-in linked keeps the identity.
*/

const (
	linkedAccountConflictCode = "FET-1097"
	linkingWriteFailedCode    = "FET-1096"
	identifyFailedCode        = "FET-1002"
)

// pauseAtProvisioning starts a registration for user under a configuration that maps nothing onto the
// required attributes, so provisioning stops to ask for them.
func (s *FederatedMappingSuite) pauseAtProvisioning(user *testutils.OIDCUserInfo) *common.FlowStep {
	s.T().Helper()
	step := s.registerExpectingPrompt(mapping(fedPersonType.Handle), user)
	s.assertPromptsFor(step, "username")
	return step
}

// completeProvisioning answers the provisioning prompt with a fresh username and email.
func (s *FederatedMappingSuite) completeProvisioning(step *common.FlowStep) (*common.FlowStep, error) {
	s.T().Helper()
	name := s.nextSubject()
	return common.CompleteFlow(step.ExecutionID,
		map[string]string{"username": name, "email": name + "@example.com"}, "", step.ChallengeToken)
}

// BC1: two registrations for one subject both reach provisioning. The first creates the user and the
// link; the second is refused rather than creating a second user holding the same identity.
func (s *FederatedMappingSuite) TestProvisioningRefusesAnIdentityLinkedMeanwhile() {
	user := s.baseUser(s.nextSubject())
	first := s.pauseAtProvisioning(user)
	second := s.pauseAtProvisioning(user)

	created, err := s.completeProvisioning(second)
	s.Require().NoError(err, "the second registration should provision")
	s.Require().Equal("COMPLETE", created.FlowStatus, "the second registration should provision, got %+v", created)
	provisioned, err := testutils.GetUserFromAssertion(created.Assertion)
	s.Require().NoError(err, "failed to look up the provisioned user")
	s.config.CreatedUserIDs = append(s.config.CreatedUserIDs, provisioned.ID)

	refused, err := s.completeProvisioning(first)
	s.Require().NoError(err, "a failed flow is still a 200 carrying its error, got %v", err)
	s.Require().Equal("ERROR", refused.FlowStatus, "the identity is linked already, got %+v", refused)
	s.Require().NotNil(refused.Error, "the terminal step should carry its error, got %+v", refused)
	s.Equal(linkedAccountConflictCode, refused.Error.Code, "expected the linked account conflict, got %+v", refused.Error)
	s.Empty(refused.Assertion, "a refused registration must not issue an assertion")

	repeat, err := s.authenticate(s.authAppID, mapping(fedPersonType.Handle), user)
	s.Require().NoError(err, "the linked identity should authenticate")
	s.Require().Equal("COMPLETE", repeat.FlowStatus, "the linked identity should authenticate, got %+v", repeat)
	claims, err := testutils.DecodeJWT(repeat.Assertion)
	s.Require().NoError(err, "failed to decode the assertion")
	s.Equal(provisioned.ID, claims.Sub, "the identity should stay with the user that linked it first")
}

// BC2: a sign-in pauses on the linking prompt while another provisions a user for the same subject.
// Verifying the candidate afterwards cannot link the identity to a second user, so the write fails.
func (s *FederatedMappingSuite) TestLinkingRefusesAnIdentityLinkedMeanwhile() {
	email, candidateID := s.linkTarget()
	user, config := s.matchingIdentity(email)
	appID := s.passwordLinkingApp("federated-verified-race")

	step, err := s.authenticate(appID, config, user)
	s.Require().NoError(err, "the matched identity should reach the linking prompt")
	s.requireLinkingPrompt(step, email)

	// The same subject, now carrying an address no account holds, provisions a user and its link.
	other := *user
	other.Email = s.nextSubject() + "@example.com"
	holder := s.registerEntity(mapping(fedPersonType.Handle, pair("email", "email"), pair("email", "username")),
		&other)
	s.Require().NotEqual(candidateID, holder.ID, "the registration should provision a user of its own")

	verification, err := common.CompleteFlow(step.ExecutionID, nil, common.LinkAccountAction, step.ChallengeToken)
	s.Require().NoError(err, "confirming the match should route to the verification step")
	final, err := common.CompleteFlow(verification.ExecutionID,
		map[string]string{"username": email, "password": candidatePassword}, common.VerifyPasswordAction,
		verification.ChallengeToken)
	s.Require().NoError(err, "a failed flow is still a 200 carrying its error, got %v", err)
	s.Require().Equal("ERROR", final.FlowStatus, "the identity is linked already, got %+v", final)
	s.Require().NotNil(final.Error, "the terminal step should carry its error, got %+v", final)
	s.Equal(linkingWriteFailedCode, final.Error.Code, "expected the refused link write, got %+v", final.Error)
	s.Empty(final.Assertion, "a refused link must not issue an assertion")
}

// BC3: a linking attribute that more users share than a sign-in may choose between matches nobody,
// rather than offering an unbounded list to verify against.
func (s *FederatedMappingSuite) TestLinkingAttributeSharedByTooManyUsersFails() {
	costCenter := "CC-" + s.nextSubject()
	for i := 0; i <= 10; i++ {
		username := s.nextSubject()
		s.createLocalUser(map[string]interface{}{
			"username":   username,
			"email":      username + "@example.com",
			"costCenter": costCenter,
		})
	}
	user := s.baseUser(s.nextSubject())
	user.Custom["cost_centre"] = costCenter
	appID := s.passwordLinkingApp("federated-verified-crowded")

	step, err := s.authenticate(appID, linkOn([]string{"costCenter"}, pair("cost_centre", "costCenter")), user)
	s.Require().NoError(err, "a failed flow is still a 200 carrying its error, got %v", err)
	s.Require().Equal("ERROR", step.FlowStatus,
		"eleven matches are too many to verify against, got %+v", step)
	s.Require().NotNil(step.Error, "the terminal step should carry its error, got %+v", step)
	s.Equal(identifyFailedCode, step.Error.Code, "expected the identification failure, got %+v", step.Error)
}

// BC4: a user holds at most a hundred linked identities, so verifying the account for one more is
// refused at the write rather than growing the user's links without bound.
func (s *FederatedMappingSuite) TestLinkingBeyondTheLinkLimitIsRefused() {
	email, _ := s.linkTarget()
	appID := s.passwordLinkingApp("federated-verified-limit")
	s.applyConfig(linkOn([]string{"email"}, pair("email", "email"), pair("email", "username")))

	linkNext := func() *common.FlowStep {
		user := s.baseUser(s.nextSubject())
		user.Email = email
		s.mockOIDC.AddUser(user)
		step, err := s.authenticateFlow(appID, user.Sub)
		s.Require().NoError(err, "the matched identity should reach the linking prompt")
		s.Require().Equal("INCOMPLETE", step.FlowStatus, "expected the linking prompt, got %+v", step)
		verification, err := common.CompleteFlow(step.ExecutionID, nil, common.LinkAccountAction, step.ChallengeToken)
		s.Require().NoError(err, "confirming the match should route to the verification step")
		final, err := common.CompleteFlow(verification.ExecutionID,
			map[string]string{"username": email, "password": candidatePassword}, common.VerifyPasswordAction,
			verification.ChallengeToken)
		s.Require().NoError(err, "a failed flow is still a 200 carrying its error, got %v", err)
		return final
	}

	for i := 0; i < 100; i++ {
		linked := linkNext()
		s.Require().Equal("COMPLETE", linked.FlowStatus, "link %d should be recorded, got %+v", i+1, linked)
	}

	refused := linkNext()
	s.Require().Equal("ERROR", refused.FlowStatus, "the hundred and first link should be refused, got %+v", refused)
	s.Require().NotNil(refused.Error, "the terminal step should carry its error, got %+v", refused)
	s.Equal(linkingWriteFailedCode, refused.Error.Code, "expected the refused link write, got %+v", refused.Error)
}
