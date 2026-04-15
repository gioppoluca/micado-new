import {inject, injectable, BindingScope} from '@loopback/core';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';
import {HttpErrors} from '@loopback/rest';
import {KeycloakAdminService} from './keycloak-admin.service';

export interface CreateNgoOrganizationRequest {
  displayName: string;
  slug: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  temporaryPassword: string;
  enabled?: boolean;
}

export interface NgoOrganizationSummary {
  groupId: string;
  groupName: string;
  displayName: string;
  slug: string;
  adminUserId?: string;
  adminEmail?: string;
}

/**
 * Bootstraps an NGO organization inside the `ngo_frontoffice` realm.
 *
 * Data model in Keycloak:
 * - one realm shared by all NGOs
 * - one top-level group per NGO
 * - one first administrator user per NGO
 * - shared realm role `ngo-admin`
 *
 * Real segregation is then enforced by the backend when the NGO admin uses
 * the NGO application to manage only the users in the same group.
 */
@injectable({scope: BindingScope.TRANSIENT})
export class NgoOrganizationBootstrapService {
  static readonly NGO_REALM = process.env.KEYCLOAK_NGO_REALM ?? 'ngo_frontoffice';
  static readonly NGO_ADMIN_ROLE = process.env.KEYCLOAK_NGO_ADMIN_ROLE ?? 'ngo-admin';
  static readonly GROUP_PREFIX = process.env.KEYCLOAK_NGO_GROUP_PREFIX ?? 'ngo-';

  constructor(
    @inject('services.KeycloakAdminService')
    private readonly keycloakAdmin: KeycloakAdminService,
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) {}

  async listOrganizations(): Promise<NgoOrganizationSummary[]> {
    const kc = await this.keycloakAdmin.getClient(
      NgoOrganizationBootstrapService.NGO_REALM,
    );

    const groups = await kc.groups.find();
    const ngoGroups = groups.filter(group =>
      this.isNgoGroup(group.name ?? '', group.attributes),
    );

    return ngoGroups.map(group => ({
      groupId: group.id ?? '',
      groupName: group.name ?? '',
      displayName:
        group.attributes?.displayName?.[0] ??
        this.fallbackDisplayName(group.name ?? ''),
      slug:
        group.attributes?.ngoSlug?.[0] ??
        this.stripPrefix(group.name ?? ''),
    }));
  }

  async createOrganizationWithAdmin(
    request: CreateNgoOrganizationRequest,
  ): Promise<NgoOrganizationSummary> {
    this.validateRequest(request);

    const slug = this.normalizeSlug(request.slug);
    const groupName = `${NgoOrganizationBootstrapService.GROUP_PREFIX}${slug}`;
    const email = request.adminEmail.trim().toLowerCase();
    const kc = await this.keycloakAdmin.getClient(
      NgoOrganizationBootstrapService.NGO_REALM,
    );

    const existingGroup = await this.findGroupByName(kc, groupName);
    if (existingGroup) {
      throw new HttpErrors.Conflict(
        `An NGO group named "${groupName}" already exists in realm ${NgoOrganizationBootstrapService.NGO_REALM}.`,
      );
    }

    const existingUser = await kc.users.find({email, exact: true});
    if (existingUser.some(user => (user.email ?? '').toLowerCase() === email)) {
      throw new HttpErrors.Conflict(
        `A Keycloak user with email "${email}" already exists in realm ${NgoOrganizationBootstrapService.NGO_REALM}.`,
      );
    }

    const adminRole = await kc.roles.findOneByName({
      name: NgoOrganizationBootstrapService.NGO_ADMIN_ROLE,
    });

    if (!adminRole?.id || !adminRole.name) {
      throw new HttpErrors.InternalServerError(
        `Required Keycloak realm role "${NgoOrganizationBootstrapService.NGO_ADMIN_ROLE}" not found in realm ${NgoOrganizationBootstrapService.NGO_REALM}.`,
      );
    }

    const createdGroup = await kc.groups.create({
      name: groupName,
      attributes: {
        ngoSlug: [slug],
        displayName: [request.displayName.trim()],
        managedBy: ['micado-backend'],
      },
    });

    const groupId = createdGroup.id ?? (await this.findGroupByName(kc, groupName))?.id;
    if (!groupId) {
      throw new HttpErrors.InternalServerError(
        `The NGO group "${groupName}" was created but its Keycloak id could not be resolved.`,
      );
    }

    try {
      const createdUser = await kc.users.create({
        username: email,
        email,
        firstName: request.adminFirstName.trim(),
        lastName: request.adminLastName.trim(),
        enabled: request.enabled ?? true,
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
        attributes: {
          ngoSlug: [slug],
          ngoGroupId: [groupId],
          managedBy: ['micado-backend'],
        },
      });

      const userId = createdUser.id;
      if (!userId) {
        throw new HttpErrors.InternalServerError(
          `The NGO admin user for "${email}" was created but its Keycloak id was not returned.`,
        );
      }

      await kc.users.resetPassword({
        id: userId,
        credential: {
          temporary: true,
          type: 'password',
          value: request.temporaryPassword,
        },
      });

      await kc.users.addToGroup({
        id: userId,
        groupId,
      });

      await kc.users.addRealmRoleMappings({
        id: userId,
        roles: [
          {
            id: adminRole.id,
            name: adminRole.name,
          },
        ],
      });

      this.logger.info(
        '[NgoOrganizationBootstrapService] NGO organization and bootstrap admin created',
        {
          realm: NgoOrganizationBootstrapService.NGO_REALM,
          groupId,
          groupName,
          adminUserId: userId,
          adminEmail: email,
          role: adminRole.name,
        },
      );

      return {
        groupId,
        groupName,
        displayName: request.displayName.trim(),
        slug,
        adminUserId: userId,
        adminEmail: email,
      };
    } catch (error) {
      this.logger.error(
        '[NgoOrganizationBootstrapService] create NGO bootstrap failed, rolling back group',
        {
          realm: NgoOrganizationBootstrapService.NGO_REALM,
          groupId,
          groupName,
          adminEmail: email,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      await kc.groups.del({id: groupId});
      throw error;
    }
  }

  private validateRequest(request: CreateNgoOrganizationRequest): void {
    if (!request.displayName?.trim()) {
      throw new HttpErrors.UnprocessableEntity('displayName is required.');
    }
    if (!request.slug?.trim()) {
      throw new HttpErrors.UnprocessableEntity('slug is required.');
    }
    if (!request.adminEmail?.trim()) {
      throw new HttpErrors.UnprocessableEntity('adminEmail is required.');
    }
    if (!request.adminFirstName?.trim()) {
      throw new HttpErrors.UnprocessableEntity('adminFirstName is required.');
    }
    if (!request.adminLastName?.trim()) {
      throw new HttpErrors.UnprocessableEntity('adminLastName is required.');
    }
    if (!request.temporaryPassword?.trim()) {
      throw new HttpErrors.UnprocessableEntity('temporaryPassword is required.');
    }
  }

  private normalizeSlug(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      throw new HttpErrors.UnprocessableEntity(
        'slug must contain at least one alphanumeric character.',
      );
    }

    return slug;
  }

  private async findGroupByName(
    kc: Awaited<ReturnType<KeycloakAdminService['getClient']>>,
    groupName: string,
  ) {
    const groups = await kc.groups.find({search: groupName});
    return groups.find(group => group.name === groupName);
  }

  private isNgoGroup(
    groupName: string,
    attributes?: Record<string, string[] | undefined>,
  ): boolean {
    return (
      groupName.startsWith(NgoOrganizationBootstrapService.GROUP_PREFIX) ||
      Array.isArray(attributes?.ngoSlug)
    );
  }

  private stripPrefix(groupName: string): string {
    return groupName.startsWith(NgoOrganizationBootstrapService.GROUP_PREFIX)
      ? groupName.slice(NgoOrganizationBootstrapService.GROUP_PREFIX.length)
      : groupName;
  }

  private fallbackDisplayName(groupName: string): string {
    return this.stripPrefix(groupName)
      .split('-')
      .map(token => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  }
}
