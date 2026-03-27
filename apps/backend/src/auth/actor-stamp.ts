/**
 * src/auth/actor-stamp.ts
 *
 * Utility for writing a consistent, self-contained actor record into the
 * `created_by` / `updated_by` / `approved_by` / `published_by` columns.
 *
 * ── Design decision ──────────────────────────────────────────────────────────
 *
 * The columns store a JSON string, NOT a bare UUID.  Rationale:
 *
 *   1. No Keycloak round-trip on read — display name and realm are embedded.
 *   2. The sub (Keycloak UUID) is preserved so the UI can still deep-link to
 *      the Keycloak admin console when needed.
 *   3. Audit records are self-contained — they survive a Keycloak user deletion.
 *   4. The realm is included so cross-realm admin actions are attributable.
 *
 * ── Shape stored in the DB ───────────────────────────────────────────────────
 *
 *   {
 *     "sub":      "383ace31-1d90-419d-8f4d-7761fdb8edec",   // Keycloak user UUID
 *     "username": "pa-admin",                                // preferred_username
 *     "name":     "PA Admin",                                // display name (may equal username)
 *     "realm":    "pa_frontoffice"                           // Keycloak realm
 *   }
 *
 * ── Usage in facades ─────────────────────────────────────────────────────────
 *
 *   import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
 *   import { SecurityBindings, UserProfile } from '@loopback/security';
 *
 *   // In constructor:
 *   @inject(SecurityBindings.USER, { optional: true })
 *   protected currentUser: UserProfile | undefined,
 *
 *   // In method:
 *   const stamp = buildActorStamp(this.currentUser);
 *   await this.contentItemRepository.create({ ..., createdBy: stamp });
 */

import { UserProfile } from '@loopback/security';

/** Typed representation of what is stored in the DB actor columns. */
export interface ActorStamp {
    /** Keycloak subject UUID — stable user identity across renames. */
    sub: string;
    /** preferred_username claim — for display without a Keycloak call. */
    username: string;
    /**
     * Display name.  Falls back to username when the token does not carry
     * a separate name claim (common with service accounts).
     */
    name: string;
    /** Keycloak realm the token was issued from. */
    realm: string;
}

/**
 * Build an ActorStamp object from the authenticated user profile.
 *
 * Returns the object directly — LoopBack writes it to the JSONB column as-is
 * (no JSON.stringify needed; the connector handles serialisation).
 * Returns `undefined` when `userProfile` is absent so callers can use
 * conditional spread: `...(stamp && { createdBy: stamp })`.
 *
 * @param userProfile  The UserProfile injected via SecurityBindings.USER.
 *                     Has shape { [securityId]: sub, id: sub, name: username,
 *                     displayName?, realm?, roles: [] } as built by
 *                     KeycloakJwtStrategy (with the realm/displayName patch).
 */
export function buildActorStamp(
    userProfile: UserProfile | undefined,
): ActorStamp | undefined {
    if (!userProfile) return undefined;

    return {
        sub: (userProfile.id ?? userProfile['sub'] ?? 'unknown') as string,
        username: (userProfile.name ?? userProfile['username'] ?? 'unknown') as string,
        name: (userProfile['displayName'] ?? userProfile.name ?? 'unknown') as string,
        realm: (userProfile['realm'] ?? 'unknown') as string,
    };
}