/**
 * src/services/ngo-group-resolver.service.ts
 *
 * Shared helper that resolves the Keycloak group UUID for a calling ngo_admin
 * or ngo_operator from their UserProfile.
 *
 * Extracted from NgoUserManagementService so that other services (e.g.
 * NgoProcessCommentService) can resolve the same group UUID using the same
 * deterministic two-path logic without duplicating code.
 *
 * ── Resolution paths ─────────────────────────────────────────────────────────
 *
 *  1. JWT `groups` claim — array of group name strings injected by the
 *     Keycloak Group Membership protocol mapper (claim.name=groups,
 *     full.path=false).  We look up the matching Keycloak group by exact name
 *     to obtain its stable UUID.
 *
 *  2. `ngoGroupId` user attribute — set by NgoOrganizationBootstrapService on
 *     every admin user it creates.  Requires one Keycloak Admin API call
 *     (users.findOne) but works without the mapper.
 *
 * There is intentionally no further fallback.  Group membership must be
 * explicit and unambiguous.  See the service JSDoc for operator guidance.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { UserProfile } from '@loopback/security';
import { KeycloakAdminService } from './keycloak-admin.service';

@injectable({ scope: BindingScope.TRANSIENT })
export class NgoGroupResolverService {
    static readonly NGO_REALM =
        process.env.KEYCLOAK_NGO_REALM ?? 'ngo_frontoffice';

    constructor(
        @inject('services.KeycloakAdminService')
        private readonly keycloakAdmin: KeycloakAdminService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    /**
     * Resolve the Keycloak group UUID for the calling NGO user.
     * Always returns a UUID string (never a name) so that different services
     * storing group identifiers in the DB use the same stable format.
     *
     * @throws HttpErrors.Forbidden when neither path resolves.
     */
    async resolve(caller: UserProfile): Promise<string> {
        const kc = await this.keycloakAdmin.getClient(NgoGroupResolverService.NGO_REALM);

        // ── Path 1: JWT groups claim ────────────────────────────────────────
        // Populated by the Keycloak Group Membership protocol mapper.
        // Emits group names (full.path=false), e.g. ["ngo-red-cross"].
        const rawGroups = (caller as Record<string, unknown>)['groups'];
        if (Array.isArray(rawGroups) && rawGroups.length > 0) {
            const groupName = String(rawGroups[0]).replace(/^\//, '');
            const found = await kc.groups.find({ search: groupName });
            const exact = found.find(g => g.name === groupName);
            if (exact?.id) {
                this.logger.debug(
                    '[NgoGroupResolverService] resolved from JWT groups claim',
                    { groupName, groupId: exact.id },
                );
                return exact.id;
            }
            // Claim present but group not found — log and fall through
            this.logger.warn(
                '[NgoGroupResolverService] groups claim present but no matching group found',
                { groupName, searchResults: found.map(g => g.name) },
            );
        }

        // ── Path 2: ngoGroupId user attribute ──────────────────────────────
        // Set by NgoOrganizationBootstrapService on every user it creates.
        const userId = caller.id ?? (caller as Record<string, unknown>)['sub'];
        if (userId) {
            const userRecord = await kc.users.findOne({ id: userId as string });
            const attrGroupId = userRecord?.attributes?.['ngoGroupId']?.[0];
            if (attrGroupId) {
                this.logger.debug(
                    '[NgoGroupResolverService] resolved from ngoGroupId user attribute',
                    { userId, groupId: attrGroupId },
                );
                return attrGroupId;
            }
        }

        // Neither path resolved
        this.logger.warn(
            '[NgoGroupResolverService] caller has no resolvable NGO group — ' +
            'user must be linked via bootstrap (POST /admin/pa/ngo-organizations) ' +
            'or via the Keycloak Group Membership mapper',
            { callerId: caller.id },
        );
        throw new HttpErrors.Forbidden(
            'Your account is not associated with any NGO organisation group. ' +
            'Ask a PA administrator to run the NGO organisation setup.',
        );
    }
}
