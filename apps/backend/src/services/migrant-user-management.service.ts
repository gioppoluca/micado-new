import { inject, injectable } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { KeycloakAdminService } from './keycloak-admin.service';

// ─────────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal migrant user summary returned to PA operators.
 * Deliberately lightweight: no roles (migrants have none in their realm),
 * but includes createdTimestamp so the PA can sort by registration date.
 */
export interface MigrantUserSummaryDto {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    /** Epoch milliseconds from Keycloak — when the user registered. */
    createdTimestamp?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MigrantUserManagementService
 *
 * Read-only (+ delete) access to the migrants Keycloak realm.
 * Migrants self-register via the migrants app — the PA never creates them here.
 *
 * ENV vars:
 *   KEYCLOAK_MIGRANTS_REALM   Target realm name (default: migrants)
 */
@injectable()
export class MigrantUserManagementService {
    private readonly realmName =
        process.env.KEYCLOAK_MIGRANTS_REALM ?? 'migrants';

    constructor(
        @inject('services.KeycloakAdminService')
        private readonly keycloakAdminService: KeycloakAdminService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    /**
     * Returns all migrant users from the Keycloak migrants realm.
     * Filters out service accounts.
     * Sorted by email (ascending).
     */
    async listUsers(): Promise<MigrantUserSummaryDto[]> {
        const kc = await this.keycloakAdminService.getClient(this.realmName);
        const users = await kc.users.find({ max: 1000 });

        const filtered = users.filter(
            u => u.id && !u.username?.startsWith('service-account-'),
        );

        const mapped: MigrantUserSummaryDto[] = filtered.map(u => ({
            id: u.id!,
            username: u.username,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            enabled: u.enabled,
            emailVerified: u.emailVerified,
            createdTimestamp: u.createdTimestamp,
        }));

        mapped.sort((a, b) =>
            (a.email ?? a.username ?? '').localeCompare(b.email ?? b.username ?? ''),
        );

        this.logger.info(
            '[MigrantUserManagementService.listUsers] listed migrant users',
            { realmName: this.realmName, count: mapped.length },
        );

        return mapped;
    }

    /**
     * Retrieves a single migrant user by Keycloak id.
     * Throws 404 if the user does not exist in the realm.
     */
    async getUserById(userId: string): Promise<MigrantUserSummaryDto> {
        const kc = await this.keycloakAdminService.getClient(this.realmName);
        const user = await this.assertUserExists(kc, userId);

        return {
            id: user.id!,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            enabled: user.enabled,
            emailVerified: user.emailVerified,
            createdTimestamp: user.createdTimestamp,
        };
    }

    /**
     * Hard-deletes a migrant user from Keycloak.
     * Use with caution — this removes all Keycloak tokens and sessions.
     * The migrant_profile row (if any) is preserved for audit; the caller
     * can decide to soft-delete it separately.
     */
    async deleteUser(userId: string): Promise<void> {
        const kc = await this.keycloakAdminService.getClient(this.realmName);
        await this.assertUserExists(kc, userId);
        await kc.users.del({ id: userId });

        this.logger.warn(
            '[MigrantUserManagementService.deleteUser] deleted migrant user',
            { realmName: this.realmName, userId },
        );
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private async assertUserExists(kc: any, userId: string): Promise<any> {
        try {
            const user = await kc.users.findOne({ id: userId });
            if (!user) {
                throw new HttpErrors.NotFound(
                    `Migrant user ${userId} not found in realm ${this.realmName}.`,
                );
            }
            return user;
        } catch (error) {
            if (HttpErrors.isHttpError(error)) throw error;
            this.logger.warn(
                '[MigrantUserManagementService.assertUserExists] user not found',
                {
                    realmName: this.realmName,
                    userId,
                    error: error instanceof Error ? error.message : String(error),
                },
            );
            throw new HttpErrors.NotFound(
                `Migrant user ${userId} not found in realm ${this.realmName}.`,
            );
        }
    }
}