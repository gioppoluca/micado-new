import { inject, injectable, BindingScope } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { UserProfile } from '@loopback/security';
import { KeycloakAdminService } from './keycloak-admin.service';
import { NgoGroupResolverService } from './ngo-group-resolver.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface NgoUserSummaryDto {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    roles: string[];
    /** Keycloak group id the user belongs to */
    groupId: string;
}

export interface CreateNgoUserInput {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    enabled?: boolean;
    roleNames?: string[];
}

export interface ReplaceNgoUserRolesInput {
    roleNames: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Manages users inside a single NGO organisation group.
 *
 * Segregation is enforced by reading the caller's group membership from their
 * Keycloak JWT (stored in the UserProfile by KeycloakJwtStrategy) and using
 * that group id as a hard filter for every Keycloak query.
 *
 * Token → group mapping:
 *   The ngo_frontoffice realm stores the group id on each user as a custom
 *   attribute `ngoGroupId`.  KeycloakJwtStrategy includes `groups` from the
 *   token claims — the service reads the first group path and resolves the
 *   matching Keycloak group id.
 *
 * Assignable roles: controlled via env var KEYCLOAK_NGO_ASSIGNABLE_ROLES
 * (comma-separated).  Falls back to filtering reserved system roles.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class NgoUserManagementService {
    static readonly NGO_REALM =
        process.env.KEYCLOAK_NGO_REALM ?? 'ngo_frontoffice';

    static readonly NGO_ADMIN_ROLE =
        process.env.KEYCLOAK_NGO_ADMIN_ROLE ?? 'ngo_admin';

    constructor(
        @inject('services.KeycloakAdminService')
        private readonly keycloakAdmin: KeycloakAdminService,
        @inject('services.NgoGroupResolverService')
        private readonly groupResolver: NgoGroupResolverService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Returns the realm roles that are safe to assign to NGO users.
     * Controlled by env var KEYCLOAK_NGO_ASSIGNABLE_ROLES (comma-separated).
     * Falls back to all non-reserved realm roles when the env var is unset.
     */
    async listAssignableRoles(): Promise<{ id?: string; name: string; description?: string }[]> {
        const kc = await this.keycloakAdmin.getClient(NgoUserManagementService.NGO_REALM);
        const allRoles = await kc.roles.find();
        const assignableNames = this.getAssignableRoleNames();

        const filtered = allRoles
            .filter(role => !!role.name)
            .filter(role => {
                if (assignableNames.length > 0) return assignableNames.includes(role.name!);
                // When no explicit list is set, exclude reserved internal roles
                return !['default-roles-' + NgoUserManagementService.NGO_REALM, 'offline_access', 'uma_authorization'].includes(role.name!);
            })
            .map(role => ({ id: role.id, name: role.name!, description: role.description }))
            .sort((a, b) => a.name.localeCompare(b.name));

        this.logger.info('[NgoUserManagementService.listAssignableRoles]', {
            realm: NgoUserManagementService.NGO_REALM,
            count: filtered.length,
        });

        return filtered;
    }

    async listUsers(caller: UserProfile): Promise<NgoUserSummaryDto[]> {
        const { kc, groupId } = await this.scopedClient(caller);

        // Keycloak: list members of the caller's group
        const members = await kc.groups.listMembers({ id: groupId, max: 500 });

        const filtered = members.filter(
            u => u.id && !u.username?.startsWith('service-account-'),
        );

        const mapped = await Promise.all(
            filtered.map(async user => {
                const roleMappings = await kc.users.listRealmRoleMappings({ id: user.id! });
                return {
                    id: user.id!,
                    username: user.username,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    enabled: user.enabled,
                    emailVerified: user.emailVerified,
                    roles: (roleMappings ?? [])
                        .map(r => r.name ?? '')
                        .filter(Boolean)
                        .sort(),
                    groupId,
                } satisfies NgoUserSummaryDto;
            }),
        );

        mapped.sort((a, b) =>
            (a.email ?? a.username ?? '').localeCompare(b.email ?? b.username ?? ''),
        );

        this.logger.info('[NgoUserManagementService.listUsers]', {
            realm: NgoUserManagementService.NGO_REALM,
            groupId,
            count: mapped.length,
        });

        return mapped;
    }

    async createUser(
        caller: UserProfile,
        input: CreateNgoUserInput,
    ): Promise<NgoUserSummaryDto> {
        const { kc, groupId } = await this.scopedClient(caller);
        const email = input.email.trim().toLowerCase();
        const roleNames = [...new Set((input.roleNames ?? []).filter(Boolean))];

        const existing = await kc.users.find({ email, exact: true });
        if (existing.some(u => (u.email ?? '').toLowerCase() === email)) {
            throw new HttpErrors.Conflict(
                `A user with email "${email}" already exists in realm ${NgoUserManagementService.NGO_REALM}.`,
            );
        }

        const created = await kc.users.create({
            username: email,
            email,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            enabled: input.enabled ?? true,
            emailVerified: false,
            requiredActions: ['UPDATE_PASSWORD'],
            attributes: {
                // Tag the user with the group so we can always reconstruct the link
                ngoGroupId: [groupId],
                managedBy: ['micado-backend'],
            },
        });

        if (!created.id) {
            throw new HttpErrors.InternalServerError(
                'Keycloak did not return the created user id.',
            );
        }

        await kc.users.resetPassword({
            id: created.id,
            credential: { temporary: true, type: 'password', value: input.password },
        });

        // Always add to the group
        await kc.users.addToGroup({ id: created.id, groupId });

        // Assign requested roles (validated against assignable list)
        await this.replaceUserRolesInternal(kc, created.id, roleNames);

        this.logger.info('[NgoUserManagementService.createUser] created NGO user', {
            realm: NgoUserManagementService.NGO_REALM,
            groupId,
            userId: created.id,
            email,
            roleNames,
        });

        return this.getUserById(caller, created.id);
    }

    async getUserById(
        caller: UserProfile,
        userId: string,
    ): Promise<NgoUserSummaryDto> {
        const { kc, groupId } = await this.scopedClient(caller);
        await this.assertUserInGroup(kc, userId, groupId);
        const user = await kc.users.findOne({ id: userId });
        const roles = await kc.users.listRealmRoleMappings({ id: userId });

        return {
            id: user!.id!,
            username: user!.username,
            email: user!.email,
            firstName: user!.firstName,
            lastName: user!.lastName,
            enabled: user!.enabled,
            emailVerified: user!.emailVerified,
            roles: (roles ?? []).map(r => r.name ?? '').filter(Boolean).sort(),
            groupId,
        };
    }

    async replaceUserRoles(
        caller: UserProfile,
        userId: string,
        input: ReplaceNgoUserRolesInput,
    ): Promise<{ userId: string; roles: string[] }> {
        const { kc, groupId } = await this.scopedClient(caller);
        await this.assertUserInGroup(kc, userId, groupId);

        const roleNames = [...new Set((input.roleNames ?? []).filter(Boolean))];
        await this.replaceUserRolesInternal(kc, userId, roleNames);

        const updatedRoles = await kc.users.listRealmRoleMappings({ id: userId });
        const names = (updatedRoles ?? [])
            .map(r => r.name ?? '')
            .filter(Boolean)
            .sort();

        this.logger.info('[NgoUserManagementService.replaceUserRoles]', {
            realm: NgoUserManagementService.NGO_REALM,
            groupId,
            userId,
            roleNames,
        });

        return { userId, roles: names };
    }

    async deleteUser(caller: UserProfile, userId: string): Promise<void> {
        const { kc, groupId } = await this.scopedClient(caller);
        await this.assertUserInGroup(kc, userId, groupId);
        await kc.users.del({ id: userId });

        this.logger.warn('[NgoUserManagementService.deleteUser] deleted NGO user', {
            realm: NgoUserManagementService.NGO_REALM,
            groupId,
            userId,
        });
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Builds an authenticated KcAdminClient scoped to the NGO realm and
     * resolves the caller's group id from the JWT.
     *
     * The group id is carried in the JWT as a Keycloak group path
     * (e.g. "/ngo-red-cross").  We strip the leading slash and look up the
     * corresponding group by name to get the stable UUID.
     *
     * Falls back to reading the `ngoGroupId` custom attribute on the user record
     * when no group paths are present in the token (older token format).
     */
    private async scopedClient(caller: UserProfile): Promise<{
        kc: Awaited<ReturnType<KeycloakAdminService['getClient']>>;
        groupId: string;
    }> {
        // Group resolution is delegated to the shared NgoGroupResolverService
        // so the same two-path logic and UUID format is used across all NGO services.
        const [kc, groupId] = await Promise.all([
            this.keycloakAdmin.getClient(NgoUserManagementService.NGO_REALM),
            this.groupResolver.resolve(caller),
        ]);
        return { kc, groupId };
    }

    /**
     * Verifies the target user is a member of the caller's group.
     * Throws 404 (not 403) to avoid leaking the existence of users in other orgs.
     */
    private async assertUserInGroup(
        kc: Awaited<ReturnType<KeycloakAdminService['getClient']>>,
        userId: string,
        groupId: string,
    ): Promise<void> {
        const groups = await kc.users.listGroups({ id: userId });
        const inGroup = (groups ?? []).some(g => g.id === groupId);
        if (!inGroup) {
            throw new HttpErrors.NotFound(
                `NGO user ${userId} not found in your organisation.`,
            );
        }
    }

    /** Validates and replaces all realm role mappings on a user. */
    private async replaceUserRolesInternal(
        kc: Awaited<ReturnType<KeycloakAdminService['getClient']>>,
        userId: string,
        roleNames: string[],
    ): Promise<void> {
        // Validate against assignable list
        const assignableNames = this.getAssignableRoleNames();
        if (assignableNames.length > 0) {
            const invalid = roleNames.filter(r => !assignableNames.includes(r));
            if (invalid.length > 0) {
                throw new HttpErrors.UnprocessableEntity(
                    `The following roles are not assignable: ${invalid.join(', ')}`,
                );
            }
        }

        // Remove all current realm roles.
        // RoleMappingPayload requires id: string (non-optional), while
        // RoleRepresentation has id?: string.  We filter out any phantom entries
        // lacking an id before casting to satisfy the stricter payload type.
        const currentRoles = await kc.users.listRealmRoleMappings({ id: userId });
        const currentRolesPayload = (currentRoles ?? [])
            .filter((r): r is typeof r & { id: string } => !!r.id)
            .map(r => ({ id: r.id, name: r.name ?? '' }));
        if (currentRolesPayload.length > 0) {
            await kc.users.delRealmRoleMappings({ id: userId, roles: currentRolesPayload });
        }

        if (roleNames.length === 0) return;

        // Re-add selected roles — same narrowing applied to the full role list.
        const allRoles = await kc.roles.find();
        const selectedPayload = allRoles
            .filter((r): r is typeof r & { id: string } => !!r.id && !!r.name && roleNames.includes(r.name))
            .map(r => ({ id: r.id, name: r.name ?? '' }));
        if (selectedPayload.length > 0) {
            await kc.users.addRealmRoleMappings({ id: userId, roles: selectedPayload });
        }
    }

    private getAssignableRoleNames(): string[] {
        return (process.env.KEYCLOAK_NGO_ASSIGNABLE_ROLES ?? '')
            .split(',')
            .map(r => r.trim())
            .filter(Boolean);
    }
}