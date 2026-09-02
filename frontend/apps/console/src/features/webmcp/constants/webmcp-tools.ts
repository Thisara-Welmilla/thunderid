// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Names of the WebMCP tools the console registers for the "Set up SSO for my app" journey.
 *
 * The `thunderid_<verb>_<noun>` shape matches the backend MCP tools (e.g.
 * `thunderid_list_applications` in `backend/internal/application/tools.go`), but every name carries
 * a `console_` segment: an agent may see both surfaces at once, and these tools navigate and drive
 * the admin's live console rather than calling the management API directly, so they must not be
 * mistaken for their server-side namesakes.
 *
 * @public
 */
const WebMcpTools = {
  LIST_ORGANIZATION_UNITS: 'thunderid_console_list_organization_units',
  SEARCH_APPLICATIONS: 'thunderid_console_search_applications',
  GET_APPLICATION: 'thunderid_console_get_application',
  LIST_LOGIN_FLOWS: 'thunderid_console_list_login_flows',
  GET_LOGIN_FLOW: 'thunderid_console_get_login_flow',
  CREATE_APPLICATION: 'thunderid_console_create_application',
  CONFIGURE_LOGIN_FLOW: 'thunderid_console_configure_login_flow',
  RUN_TEST_LOGIN: 'thunderid_console_run_test_login',
} as const;

export default WebMcpTools;
