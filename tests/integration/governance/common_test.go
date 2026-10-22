// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package governance checks the accountAccess and notification sections, and the events their writes
// publish, against a running server.
// Tests check stated behaviour, not the implementation that satisfies it.
package governance

import (
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/thunder-id/thunderid/tests/integration/testutils"
)

const (
	testServerURL = testutils.TestServerURL

	// pristineDeploymentPath is the deployment the harness copies in at start-up, relative to this
	// package. Restoring it is how a deployment change this package makes is undone.
	pristineDeploymentPath = "../resources/deployment.yaml"
)

// The policy this package applies through deployment.yaml or a declarative document: short values for
// the section tests.
const (
	lockThreshold     = 3
	firstRungSeconds  = 8
	secondRungSeconds = 30
	failureWindowSecs = 600
	lockDecaySeconds  = 3600
)

// lockoutPolicy is this package's accountAccess policy. Every sign-in method counts under its own key
// with the category default.
func lockoutPolicy() map[string]interface{} {
	return map[string]interface{}{
		"user": map[string]interface{}{
			"lockGranularity": "authentication_method",
			"default": map[string]interface{}{
				"enabled":              true,
				"threshold":            lockThreshold,
				"failureWindowSeconds": failureWindowSecs,
				"lockDurationsSeconds": []int{firstRungSeconds, secondRungSeconds},
				"lockDecaySeconds":     lockDecaySeconds,
			},
		},
	}
}

// getManagement reads one management resource as the administrator, requires it to be answered and
// returns the body.
func getManagement(t *testing.T, path string) []byte {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, testServerURL+path, nil)
	require.NoError(t, err)
	req.Header.Set("Accept", "application/json")

	resp, err := testutils.GetHTTPClient().Do(req)
	require.NoError(t, err, "the read of %s failed", path)
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "an administrator must be able to read %s: %s",
		path, string(body))
	return body
}

// applyDeclarativePolicy installs a declarative accountAccess document, which locks the section and
// needs a restart, and restores the harness deployment when t ends. The restore is registered before
// anything changes, so a setup that fails part way still leaves the next suite on the shipped policy.
func applyDeclarativePolicy(t *testing.T, policy interface{}) {
	t.Helper()

	t.Cleanup(func() { restoreShippedPolicy(t) })
	require.NoError(t, testutils.UpdateAccountAccessConfig(policy), "failed to apply the lockout policy")
	require.NoError(t, testutils.RestartServer(), "failed to restart with the lockout policy")
	require.NoError(t, testutils.ObtainAdminAccessToken(), "failed to re-obtain the admin token")
}

// deploymentLockoutPatch is lockoutPolicy in the deployment file's snake_case form.
func deploymentLockoutPatch() map[string]interface{} {
	return map[string]interface{}{
		"account_access": map[string]interface{}{
			"user": map[string]interface{}{
				"lock_granularity": "authentication_method",
				"default": map[string]interface{}{
					"enabled":                true,
					"threshold":              lockThreshold,
					"failure_window_seconds": failureWindowSecs,
					"lock_durations_seconds": []int{firstRungSeconds, secondRungSeconds},
					"lock_decay_seconds":     lockDecaySeconds,
				},
			},
		},
	}
}

// applyDeploymentLockoutPolicy installs this package's policy through deployment.yaml, which is the
// base the section overlays and leaves it writable.
func applyDeploymentLockoutPolicy(t *testing.T) {
	t.Helper()

	t.Cleanup(func() { restoreShippedPolicy(t) })
	require.NoError(t, testutils.PatchDeploymentConfig(deploymentLockoutPatch()),
		"failed to apply the lockout policy")
	require.NoError(t, testutils.RestartServer(), "failed to restart with the lockout policy")
	require.NoError(t, testutils.ObtainAdminAccessToken(), "failed to re-obtain the admin token")
}

// restoreShippedPolicy removes the declarative accountAccess document and restores the harness
// deployment. Each step runs even if an earlier one failed, and a failure fails the test: a policy
// left behind would show up as unrelated failures in the next package.
func restoreShippedPolicy(t *testing.T) {
	t.Helper()

	if err := testutils.RestoreAccountAccessConfig(); err != nil {
		t.Errorf("cleanup: failed to restore accountAccess config: %v", err)
	}
	if err := testutils.UpdateDeploymentConfig(pristineDeploymentPath); err != nil {
		t.Errorf("cleanup: failed to restore the deployment config: %v", err)
	}
	if err := testutils.RestartServer(); err != nil {
		t.Errorf("cleanup: server did not restart cleanly after restoring the policy: %v", err)
		return
	}
	if err := testutils.ObtainAdminAccessToken(); err != nil {
		t.Errorf("cleanup: failed to re-obtain the admin token after restoring the policy: %v", err)
	}
}

// putSection writes a server-config section's writable layer and returns the status and body, for a
// write whose refusal is the subject rather than an error.
func putSection(t *testing.T, section, body string) (int, string) {
	t.Helper()
	status, response, err := testutils.PutWritableServerConfigWithStatus(section, []byte(body))
	require.NoError(t, err, "the %s write must be answered", section)
	return status, string(response)
}
