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
  createdTimestamp?: number;
}

export interface KeycloakRealmRole {
  id?: string;
  name?: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

export interface CreatePaUserPayload {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  roles: string[];
  enabled?: boolean;
}

export interface UpdatePaUserRolesPayload {
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

  async getUserRoles(id: string): Promise<KeycloakRealmRole[]> {
    logger.info('[pa-users.api] getUserRoles', { id });
    return apiGet<KeycloakRealmRole[]>(`/admin/pa/users/${id}/roles`);
  },

  async createUser(payload: CreatePaUserPayload): Promise<PaUser> {
    logger.info('[pa-users.api] createUser', { email: payload.email, roleCount: payload.roles.length });
    return apiPost<PaUser>('/admin/pa/users', payload);
  },

  async updateUserRoles(id: string, payload: UpdatePaUserRolesPayload): Promise<void> {
    logger.info('[pa-users.api] updateUserRoles', { id, roleCount: payload.roles.length });
    return apiPut<void>(`/admin/pa/users/${id}/roles`, payload);
  },

  async removeUser(id: string): Promise<void> {
    logger.warn('[pa-users.api] removeUser', { id });
    return apiDelete(`/admin/pa/users/${id}`);
  },
};
