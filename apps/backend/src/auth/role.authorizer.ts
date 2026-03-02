import {
    AuthorizationContext,
    AuthorizationDecision,
    AuthorizationMetadata,
    Authorizer,
} from '@loopback/authorization';
import { inject, Provider } from '@loopback/core';
import { securityId } from '@loopback/security';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { log } from 'console';

export class RoleAuthorizerProvider implements Provider<Authorizer> {
    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    value(): Authorizer {
        return async (
            ctx: AuthorizationContext,
            metadata: AuthorizationMetadata,
        ): Promise<AuthorizationDecision> => {
            const principal = ctx.principals[0];
            this.logger.info('[AUTHZ] Authorizer invoked', {
                user: principal ? principal[securityId] : 'unknown',
                allowedRoles: metadata.allowedRoles,
            });
            if (!principal) {
                this.logger.warn('[AUTHZ] No principal -> DENY');
                return AuthorizationDecision.DENY;
            }

            const allowedRoles = metadata.allowedRoles ?? [];

            // With defaultDecision DENY, endpoints without @authorize(...) should usually be explicit
            // Return ABSTAIN so the framework default applies (DENY in your case).
            if (allowedRoles.length === 0) {
                this.logger.info('[AUTHZ] No allowedRoles metadata -> ABSTAIN', {
                    user: principal[securityId],
                });
                return AuthorizationDecision.ABSTAIN;
            }

            // Expected shape: principal.roles is string[]
            const userRolesRaw = (principal as any).roles;
            const userRoles: string[] = Array.isArray(userRolesRaw) ? userRolesRaw : [];

            const matched = allowedRoles.some(r => userRoles.includes(r));
            log('[AUTHZ] allowedRoles', allowedRoles);
            log('[AUTHZ] userRoles', userRoles);
            log('[AUTHZ] matched', matched);
            this.logger.info('[AUTHZ] Role check', {
                user: principal[securityId],
                userRoles,
                allowedRoles,
                matched,
            });

            return matched ? AuthorizationDecision.ALLOW : AuthorizationDecision.DENY;
        };
    }
}