/**
 * src/api/ngo-users.api.ts
 *
 * HTTP calls for NGO user management — group-scoped to the caller's organisation.
 *
 * Backend endpoints (NgoOrganizationsAdminController):
 *   GET  /admin/ngo/users          → list users in the caller's group
 *   POST /admin/ngo/users          → create user inside the caller's group
 *   GET  /admin/ngo/users/:id      → get one user (must be in caller's group)
 *   PUT  /admin/ngo/users/:id/roles → replace assignable roles
 *   DEL  /admin/ngo/users/:id      → delete user (must be in caller's group)
 *   GET  /admin/ngo/roles          → list assignable roles for the ngo realm
 *
 * Auth: all endpoints require Bearer token with role `ngo_admin`
 * (realm ngo_frontoffice).
 *
 * Group segregation: enforced on the backend — the service reads the caller's
 * group from the JWT `groups` claim and restricts every Keycloak query to that
 * group.  The frontend never needs to know or pass the groupId explicitly.
 */

import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NgoUser {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    /** Realm roles currently assigned to the user */
    roles: string[];
    /** Keycloak group id the user belongs to (same as caller's group) */
    groupId: string;
}

export interface NgoRealmRole {
    id?: string;
    /** Role name — always present in Keycloak responses */
    name: string;
    description?: string;
}

export interface CreateNgoUserPayload {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    /** Roles to assign at creation — must be from the assignable list */
    roleNames: string[];
    enabled?: boolean;
}

export interface UpdateNgoUserRolesPayload {
    roleNames: string[];
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const ngoUsersApi = {
    /**
     * List all users in the caller's NGO organisation group.
     * Auth: ngo_admin
     */
    async listUsers(): Promise<NgoUser[]> {
        logger.info('[ngo-users.api] listUsers');
        return apiGet<NgoUser[]>('/admin/ngo/users');
    },

    /**
     * List assignable realm roles for the ngo_frontoffice realm.
     * Used to populate role pickers in the UI.
     * Auth: ngo_admin
     */
    async listRoles(): Promise<NgoRealmRole[]> {
        logger.info('[ngo-users.api] listRoles');
        return apiGet<NgoRealmRole[]>('/admin/ngo/roles');
    },

    /**
     * Fetch a single user by id (must belong to caller's group).
     * Auth: ngo_admin
     */
    async getUser(id: string): Promise<NgoUser> {
        logger.info('[ngo-users.api] getUser', { id });
        return apiGet<NgoUser>(`/admin/ngo/users/${id}`);
    },

    /**
     * Create a new user inside the caller's NGO organisation group.
     * Auth: ngo_admin
     */
    async createUser(payload: CreateNgoUserPayload): Promise<NgoUser> {
        logger.info('[ngo-users.api] createUser', {
            email: payload.email,
            roleCount: payload.roleNames.length,
        });
        return apiPost<NgoUser>('/admin/ngo/users', payload);
    },

    /**
     * Replace all assignable roles for an NGO user.
     * Sends { roleNames } to match the backend ReplaceNgoUserRolesInput schema.
     * Auth: ngo_admin
     */
    async updateUserRoles(id: string, payload: UpdateNgoUserRolesPayload): Promise<void> {
        logger.info('[ngo-users.api] updateUserRoles', {
            id,
            roleCount: payload.roleNames.length,
        });
        return apiPut<void>(`/admin/ngo/users/${id}/roles`, payload);
    },

    /**
     * Delete an NGO user (must belong to caller's group).
     * Auth: ngo_admin
     */
    async removeUser(id: string): Promise<void> {
        logger.warn('[ngo-users.api] removeUser', { id });
        return apiDelete(`/admin/ngo/users/${id}`);
    },
};
