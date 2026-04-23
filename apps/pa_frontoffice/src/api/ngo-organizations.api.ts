import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

// ── DTOs mirroring backend types ──────────────────────────────────────────────

export interface NgoOrganization {
    groupId: string;
    groupName: string;
    displayName: string;
    slug: string;
    adminUserId?: string;
    adminEmail?: string;
    /** Contact email shown to migrants for the send-document dropdown. */
    contactEmail?: string;
}

export interface CreateNgoOrganizationPayload {
    displayName: string;
    slug: string;
    /** Optional: email address migrants can send documents to. Stored as a Keycloak group attribute. */
    contactEmail?: string;
    adminEmail: string;
    adminFirstName: string;
    adminLastName: string;
    temporaryPassword: string;
    enabled?: boolean;
}

export interface NgoUser {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    roles: string[];
    groupId: string;
}

export interface CreateNgoUserPayload {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    enabled?: boolean;
    roleNames?: string[];
}

/**
 * Response envelope for GET /admin/ngo/users/:id/roles.
 * Matches the backend { userId, roles } shape.
 */
export interface NgoUserRolesResponse {
    userId: string;
    roles: string[];
}

export interface UpdateNgoUserRolesPayload {
    roleNames: string[];
}

// ── API object ────────────────────────────────────────────────────────────────

export const ngoOrganizationsApi = {
    // ── PA admin: organization management ──────────────────────────────────────

    async listOrganizations(): Promise<NgoOrganization[]> {
        logger.info('[ngo-organizations.api] listOrganizations');
        return apiGet<NgoOrganization[]>('/admin/pa/ngo-organizations');
    },

    async createOrganization(
        payload: CreateNgoOrganizationPayload,
    ): Promise<NgoOrganization> {
        logger.info('[ngo-organizations.api] createOrganization', {
            slug: payload.slug,
            adminEmail: payload.adminEmail,
        });
        return apiPost<NgoOrganization>('/admin/pa/ngo-organizations', payload);
    },

    // ── NGO admin: user management (group-scoped) ───────────────────────────────

    async listNgoUsers(): Promise<NgoUser[]> {
        logger.info('[ngo-organizations.api] listNgoUsers');
        return apiGet<NgoUser[]>('/admin/ngo/users');
    },

    async createNgoUser(payload: CreateNgoUserPayload): Promise<NgoUser> {
        logger.info('[ngo-organizations.api] createNgoUser', {
            email: payload.email,
        });
        return apiPost<NgoUser>('/admin/ngo/users', payload);
    },

    async getNgoUser(id: string): Promise<NgoUser> {
        logger.info('[ngo-organizations.api] getNgoUser', { id });
        return apiGet<NgoUser>(`/admin/ngo/users/${id}`);
    },

    async updateNgoUserRoles(
        id: string,
        payload: UpdateNgoUserRolesPayload,
    ): Promise<void> {
        logger.info('[ngo-organizations.api] updateNgoUserRoles', {
            id,
            roleCount: payload.roleNames.length,
        });
        return apiPut<void>(`/admin/ngo/users/${id}/roles`, payload);
    },

    async removeNgoUser(id: string): Promise<void> {
        logger.warn('[ngo-organizations.api] removeNgoUser', { id });
        return apiDelete(`/admin/ngo/users/${id}`);
    },
};