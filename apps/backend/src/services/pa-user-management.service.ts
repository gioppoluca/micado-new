import {inject, injectable} from '@loopback/core';
import {HttpErrors} from '@loopback/rest';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';
import {KeycloakAdminService} from './keycloak-admin.service';

export interface PaAssignableRoleDto {
  id?: string;
  name: string;
  description?: string;
}

export interface PaUserSummaryDto {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  roles: string[];
}

export interface CreatePaUserInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  enabled?: boolean;
  roleNames?: string[];
}

export interface ReplacePaUserRolesInput {
  roleNames: string[];
}

@injectable()
export class PaUserManagementService {
  private readonly realmName = process.env.KEYCLOAK_PA_REALM ?? 'pa_frontoffice';

  constructor(
    @inject('services.KeycloakAdminService')
    private readonly keycloakAdminService: KeycloakAdminService,
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) {}

  async listUsers(): Promise<PaUserSummaryDto[]> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    const users = await kc.users.find({max: 500});

    const filteredUsers = users.filter(
      user => user.id && !user.username?.startsWith('service-account-'),
    );

    const mapped = await Promise.all(
      filteredUsers.map(async user => {
        const roleMappings = await kc.users.listRealmRoleMappings({id: user.id!});
        return {
          id: user.id!,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          enabled: user.enabled,
          emailVerified: user.emailVerified,
          roles: (roleMappings ?? []).map(role => role.name ?? '').filter(Boolean).sort(),
        } satisfies PaUserSummaryDto;
      }),
    );

    mapped.sort((a, b) => (a.email ?? a.username ?? '').localeCompare(b.email ?? b.username ?? ''));

    this.logger.info('[PaUserManagementService.listUsers] listed PA users', {
      realmName: this.realmName,
      count: mapped.length,
    });

    return mapped;
  }

  async listAssignableRoles(): Promise<PaAssignableRoleDto[]> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    const roles = await kc.roles.find();
    const assignableNames = this.getExplicitAssignableRoleNames();

    const filtered = roles
      .filter(role => !!role.name)
      .filter(role => {
        if (assignableNames.length > 0) return assignableNames.includes(role.name!);
        return !this.isReservedRole(role.name!);
      })
      .map(role => ({
        id: role.id,
        name: role.name!,
        description: role.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.logger.info('[PaUserManagementService.listAssignableRoles] listed assignable roles', {
      realmName: this.realmName,
      count: filtered.length,
    });

    return filtered;
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    await this.assertUserExists(kc, userId);
    const roles = await kc.users.listRealmRoleMappings({id: userId});
    return (roles ?? []).map(role => role.name ?? '').filter(Boolean).sort();
  }

  async createUser(input: CreatePaUserInput): Promise<PaUserSummaryDto> {
    const email = input.email.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const password = input.password;
    const roleNames = [...new Set((input.roleNames ?? []).filter(Boolean))];
    const enabled = input.enabled ?? true;

    const kc = await this.keycloakAdminService.getClient(this.realmName);

    const existing = await kc.users.find({email, exact: true});
    if (existing.some(user => user.email?.toLowerCase() === email || user.username?.toLowerCase() === email)) {
      throw new HttpErrors.Conflict(`A Keycloak user with email ${email} already exists in realm ${this.realmName}.`);
    }

    const created = await kc.users.create({
      username: email,
      email,
      firstName,
      lastName,
      enabled,
      emailVerified: false,
      requiredActions: ['UPDATE_PASSWORD'],
    });

    if (!created.id) {
      throw new HttpErrors.InternalServerError('Keycloak did not return the created user id.');
    }

    await kc.users.resetPassword({
      id: created.id,
      credential: {
        temporary: true,
        type: 'password',
        value: password,
      },
    });

    await this.replaceUserRolesInternal(kc, created.id, roleNames);

    this.logger.info('[PaUserManagementService.createUser] created PA user', {
      realmName: this.realmName,
      userId: created.id,
      email,
      roleNames,
    });

    return this.getUserById(created.id);
  }

  async replaceUserRoles(userId: string, input: ReplacePaUserRolesInput): Promise<{userId: string; roles: string[]}> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    await this.assertUserExists(kc, userId);
    const roleNames = [...new Set((input.roleNames ?? []).filter(Boolean))];
    await this.replaceUserRolesInternal(kc, userId, roleNames);

    this.logger.info('[PaUserManagementService.replaceUserRoles] replaced PA user roles', {
      realmName: this.realmName,
      userId,
      roleNames,
    });

    return {
      userId,
      roles: await this.getUserRoles(userId),
    };
  }

  async deleteUser(userId: string): Promise<void> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    await this.assertUserExists(kc, userId);
    await kc.users.del({id: userId});

    this.logger.warn('[PaUserManagementService.deleteUser] deleted PA user', {
      realmName: this.realmName,
      userId,
    });
  }

  async getUserById(userId: string): Promise<PaUserSummaryDto> {
    const kc = await this.keycloakAdminService.getClient(this.realmName);
    const user = await this.assertUserExists(kc, userId);
    const roles = await kc.users.listRealmRoleMappings({id: userId});

    return {
      id: user.id!,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: user.enabled,
      emailVerified: user.emailVerified,
      roles: (roles ?? []).map(role => role.name ?? '').filter(Boolean).sort(),
    };
  }

  private async replaceUserRolesInternal(kc: any, userId: string, roleNames: string[]): Promise<void> {
    const assignableRoles = await this.listAssignableRoles();
    const assignableRoleNames = assignableRoles.map(role => role.name);
    const invalidRoleNames = roleNames.filter(roleName => !assignableRoleNames.includes(roleName));

    if (invalidRoleNames.length > 0) {
      throw new HttpErrors.UnprocessableEntity(
        `The following roles are not assignable through the PA admin UI: ${invalidRoleNames.join(', ')}`,
      );
    }

    const currentRoles = await kc.users.listRealmRoleMappings({id: userId});
    if ((currentRoles ?? []).length > 0) {
      await kc.users.delRealmRoleMappings({
        id: userId,
        roles: currentRoles,
      });
    }

    if (roleNames.length === 0) return;

    const allRoles = await kc.roles.find();
    const selectedRoles = allRoles.filter((role: {name?: string}) => role.name && roleNames.includes(role.name));

    if (selectedRoles.length > 0) {
      await kc.users.addRealmRoleMappings({
        id: userId,
        roles: selectedRoles,
      });
    }
  }

  private async assertUserExists(kc: any, userId: string): Promise<any> {
    try {
      return await kc.users.findOne({id: userId});
    } catch (error) {
      this.logger.warn('[PaUserManagementService.assertUserExists] user not found', {
        realmName: this.realmName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpErrors.NotFound(`PA user ${userId} not found in realm ${this.realmName}.`);
    }
  }

  private isReservedRole(roleName: string): boolean {
    const normalized = roleName.trim();
    const reservedNames = new Set([
      `default-roles-${this.realmName}`,
      'offline_access',
      'uma_authorization',
    ]);

    if (reservedNames.has(normalized)) return true;
    if (normalized.startsWith('default-roles-')) return true;
    if (normalized.startsWith('manage-')) return true;
    if (normalized.startsWith('view-')) return true;
    if (normalized.startsWith('query-')) return true;
    if (normalized.startsWith('impersonation')) return true;
    if (normalized.startsWith('create-client')) return true;
    if (normalized.startsWith('realm-admin')) return true;
    return false;
  }

  private getExplicitAssignableRoleNames(): string[] {
    return (process.env.KEYCLOAK_PA_ASSIGNABLE_ROLES ?? '')
      .split(',')
      .map(role => role.trim())
      .filter(Boolean);
  }
}
