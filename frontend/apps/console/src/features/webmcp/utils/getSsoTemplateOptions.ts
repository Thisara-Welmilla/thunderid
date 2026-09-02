// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {OAuth2GrantTypes} from '@thunderid/configure-applications';
import PlatformBasedApplicationTemplateMetadata from '../../applications/config/PlatformBasedApplicationTemplateMetadata';
import TechnologyBasedApplicationTemplateMetadata from '../../applications/config/TechnologyBasedApplicationTemplateMetadata';
import type {ApplicationTemplate, ApplicationTemplateMetadata} from '../../applications/models/application-templates';

/**
 * Application types that sign an end user in through a browser redirect. A machine-to-machine or
 * wallet client is not part of the "set up SSO for my app" journey.
 *
 * @internal
 */
const SSO_APPLICATION_TYPES: readonly string[] = ['browser', 'fullstack'];

/**
 * A template the guided journey is allowed to create an application from.
 *
 * @public
 */
export interface SsoTemplateOption {
  /**
   * The template identifier accepted as the tool's `template` input, and the value the
   * `?type=` deep link into the template gallery carries (e.g. `REACT`).
   */
  value: string;
  /**
   * The template's own id, as stored on the created application (e.g. `react`).
   */
  templateId: string;
  /**
   * Human-readable name, used in the confirmation dialog and in the tool description.
   */
  displayName: string;
}

/**
 * Whether a template's seeded OAuth2 profile is one the guided journey may create.
 *
 * The tool does not accept grant types, PKCE, public-client or token-endpoint auth method as
 * inputs; they come from the template's own `defaults` and `fieldConstraints`. Restricting the
 * accepted templates to those already seeded with authorization code *and* `pkceRequired` is
 * therefore what enforces "authorization code + PKCE by default", and is why the implicit grant is
 * not reachable through this tool at all. Templates whose defaults omit PKCE (e.g. `express`,
 * `node`) are excluded rather than silently upgraded, because the wizard marks these fields
 * read-only for some templates and rewriting them here would diverge from what a human gets.
 *
 * @internal
 */
function isSecureSsoTemplate(template: ApplicationTemplate): boolean {
  if (!template.type || !SSO_APPLICATION_TYPES.includes(template.type)) {
    return false;
  }

  const oauth2 = template.defaults?.inboundAuthConfig?.find((config) => config.type === 'oauth2')?.config;

  return Boolean(oauth2?.grantTypes?.includes(OAuth2GrantTypes.AUTHORIZATION_CODE) && oauth2.pkceRequired === true);
}

/**
 * Lists the templates the guided SSO journey may create an application from, derived from the same
 * template metadata the template gallery renders so a new template is picked up automatically.
 *
 * @returns The eligible templates, ordered technology-first as in the gallery
 *
 * @public
 */
export default function getSsoTemplateOptions(): SsoTemplateOption[] {
  const allTemplates: ApplicationTemplateMetadata[] = [
    ...TechnologyBasedApplicationTemplateMetadata,
    ...PlatformBasedApplicationTemplateMetadata,
  ];

  return allTemplates
    .filter((metadata) => Boolean(metadata.template.id) && isSecureSsoTemplate(metadata.template))
    .map((metadata) => {
      const templateId: string = metadata.template.id!;

      return {
        value: metadata.value,
        templateId,
        displayName: metadata.template.displayName ?? templateId,
      };
    });
}
