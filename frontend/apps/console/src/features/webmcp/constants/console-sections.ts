// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import RouteConfig from '../../../configs/RouteConfig';

/**
 * A top-level console destination the navigation tools can move to.
 *
 * `path` is the app-relative route (as `RouteConfig` produces it), which is exactly what
 * `useNavigate()` expects: the console router is mounted under the `/console` basename, so call
 * sites navigate with paths like `/applications`, not `/console/applications`.
 *
 * @public
 */
export interface ConsoleSection {
  /** Stable identifier the agent passes to the navigate tool. */
  id: string;
  /** Human-facing section name, matching the console's own navigation. */
  title: string;
  /** One line telling the agent what lives in the section, so it can pick the right one. */
  description: string;
  /** App-relative route to navigate to. */
  path: string;
}

/**
 * The sections the WebMCP navigation tools expose, in the order a quickstart would visit them:
 * Home and Get Started first, then the entities an admin secures, then the supporting configuration.
 *
 * Every `path` comes from {@link RouteConfig} rather than a hand-written string, so a route rename
 * updates the destination here in step with the rest of the console and the two can't drift apart.
 * The list is intentionally limited to landing pages that are safe to open unprompted: there is no
 * create/detail route here, so navigating never lands the admin mid-wizard or on a record they did
 * not ask for.
 *
 * @public
 */
const ConsoleSections: readonly ConsoleSection[] = [
  {
    id: 'home',
    title: 'Home',
    description: 'The console landing page.',
    path: RouteConfig.home.list(),
  },
  {
    id: 'getStarted',
    title: 'Get Started',
    description:
      'The guided quickstart for securing an application, an AI agent, or an MCP server. Start here to onboard.',
    path: RouteConfig.welcome.getStarted(),
  },
  {
    id: 'applications',
    title: 'Applications',
    description: 'Register and manage OAuth2 / OIDC applications.',
    path: RouteConfig.applications.list(),
  },
  {
    id: 'agents',
    title: 'AI Agents',
    description: 'Manage AI agent identities and their delegated access.',
    path: RouteConfig.agents.list(),
  },
  {
    id: 'flows',
    title: 'Login Flows',
    description: 'Design authentication, registration, and recovery flows.',
    path: RouteConfig.flows.list(),
  },
  {
    id: 'connections',
    title: 'Connections',
    description: 'Configure external identity providers such as Google, GitHub, and any OIDC or SAML provider.',
    path: RouteConfig.connections.list(),
  },
  {
    id: 'organizationUnits',
    title: 'Organization Units',
    description: 'Manage the hierarchy of organization units.',
    path: RouteConfig.organizationUnits.list(),
  },
  {
    id: 'users',
    title: 'Users',
    description: 'Manage user accounts.',
    path: RouteConfig.users.list(),
  },
  {
    id: 'userTypes',
    title: 'User Types',
    description: 'Define the schema and settings for each kind of user.',
    path: RouteConfig.userTypes.list(),
  },
  {
    id: 'groups',
    title: 'Groups',
    description: 'Organize users into groups.',
    path: RouteConfig.groups.list(),
  },
  {
    id: 'roles',
    title: 'Roles',
    description: 'Define roles and the permissions they grant.',
    path: RouteConfig.roles.list(),
  },
  {
    id: 'resourceServers',
    title: 'API Resources',
    description: 'Register resource servers and the scopes they expose.',
    path: RouteConfig.resourceServers.list(),
  },
  {
    id: 'verifiableCredentials',
    title: 'Verifiable Credentials',
    description: 'Manage the verifiable credential templates the deployment can issue.',
    path: RouteConfig.verifiableCredentials.list(),
  },
  {
    id: 'verifiablePresentations',
    title: 'Verifiable Presentations',
    description: 'Manage the verifiable presentation definitions the deployment can verify.',
    path: RouteConfig.verifiablePresentations.list(),
  },
  {
    id: 'design',
    title: 'Design',
    description: 'Customize the themes and layouts of the end-user UI.',
    path: RouteConfig.design.list(),
  },
  {
    id: 'translations',
    title: 'Translations',
    description: 'Manage the text translations for the end-user UI.',
    path: RouteConfig.translations.list(),
  },
  {
    id: 'importExport',
    title: 'Import / Export',
    description: 'Import or export the deployment configuration as declarative YAML.',
    path: RouteConfig.importExport.list(),
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Server-level settings for the deployment.',
    path: RouteConfig.settings.list(),
  },
] as const;

export default ConsoleSections;
