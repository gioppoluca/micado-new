import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

export interface PaUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  /**
   * Roles are already embedded in the listUsers() response (PaUserSummaryDto).
   * The separate getUserRoles() call is used only to get a fresh snapshot
   * when populating the roles dialog.
   */
  roles?: string[];
}

export interface KeycloakRealmRole {
  id?: string;
  name?: string;
  description?: string;
}

export interface CreatePaUserPayload {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  /** Sent as roleNames to match the backend CreatePaUserInput schema. */
  roleNames: string[];
  enabled?: boolean;
}

/**
 * Matches the backend ReplacePaUserRolesInput: { roleNames: string[] }
 * The controller PUT /admin/pa/users/{id}/roles expects this exact shape.
 */
export interface UpdatePaUserRolesPayload {
  roleNames: string[];
}

/**
 * Response shape of GET /admin/pa/users/{id}/roles
 * The backend wraps the array in an envelope: { userId, roles: string[] }
 */
export interface UserRolesResponse {
  userId: string;
  roles: string[];
}

export const paUsersApi = {
  async listUsers(): Promise<PaUser[]> {
    logger.info('[pa-users.api] listUsers');
    return apiGet<PaUser[]>('/admin/pa/users');
  },

  async listRoles(): Promise<KeycloakRealmRole[]> {
    logger.info('[pa-users.api] listRoles');
    return apiGet<KeycloakRealmRole[]>('/admin/pa/roles');
  },

  /**
   * Returns the roles assigned to a specific user.
   *
   * The backend returns { userId, roles: string[] } — this method unwraps
   * the envelope and returns the plain string array so callers don't need
   * to know about the wrapper shape.
   */
  async getUserRoles(id: string): Promise<string[]> {
    logger.info('[pa-users.api] getUserRoles', { id });
    const response = await apiGet<UserRolesResponse>(`/admin/pa/users/${id}/roles`);
    // Defensive: handle both the envelope shape and a bare array (forward compat)
    if (Array.isArray(response)) return response as unknown as string[];
    return Array.isArray(response?.roles) ? response.roles : [];
  },

  async createUser(payload: CreatePaUserPayload): Promise<PaUser> {
    logger.info('[pa-users.api] createUser', {
      email: payload.email,
      roleCount: payload.roleNames.length,
    });
    return apiPost<PaUser>('/admin/pa/users', payload);
  },

  /**
   * Replaces all assignable roles for a PA user.
   * Sends { roleNames } to match the backend ReplacePaUserRolesInput schema.
   */
  async updateUserRoles(id: string, payload: UpdatePaUserRolesPayload): Promise<void> {
    logger.info('[pa-users.api] updateUserRoles', { id, roleCount: payload.roleNames.length });
    return apiPut<void>(`/admin/pa/users/${id}/roles`, payload);
  },

  async removeUser(id: string): Promise<void> {
    logger.warn('[pa-users.api] removeUser', { id });
    return apiDelete(`/admin/pa/users/${id}`);
  },
};