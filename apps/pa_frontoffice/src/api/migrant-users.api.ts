/**
 * src/api/migrant-users.api.ts
 *
 * API client for migrant user management and intervention plans.
 *
 * ── Authorization matrix (enforced server-side) ──────────────────────────────
 *
 *   listMigrants / getMigrant     pa_admin | pa_operator | pa_viewer
 *   deleteMigrant                 pa_admin only
 *   listPlans / getPlan           pa_admin | pa_operator | pa_viewer
 *   createPlan / updatePlan       pa_admin | pa_operator
 *   deletePlan                    pa_admin only
 *   createItem / updateItem       pa_admin | pa_operator
 *   requestValidation             pa_admin | pa_operator
 *   deleteItem                    pa_admin only
 */

import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';

// ─────────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrantUser {
    id: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    /** Epoch ms — when the migrant registered in Keycloak. */
    createdTimestamp?: number;
}

export interface InterventionPlan {
    id: string;
    migrantId: string;
    title?: string;
    caseManager?: string;
    startDate?: string;
    endDate?: string;
    completed: boolean;
    notes?: string;
    createdBy?: { sub: string; username: string; name: string; realm: string };
    createdAt: string;
    updatedAt: string;
    /** Present on GET /plans/:id, absent on list. */
    items?: InterventionPlanItem[];
}

export interface InterventionPlanItem {
    id: string;
    planId: string;
    interventionTypeId?: string;
    title?: string;
    description?: string;
    assignedDate?: string;
    dueDate?: string;
    completed: boolean;
    completedDate?: string;
    validationRequestedAt?: string;
    validatedBy?: { sub: string; username: string; name: string; realm: string };
    validatedAt?: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreatePlanPayload {
    title?: string;
    caseManager?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
}

export interface UpdatePlanPayload {
    title?: string;
    caseManager?: string;
    startDate?: string;
    endDate?: string;
    completed?: boolean;
    notes?: string;
}

export interface CreatePlanItemPayload {
    interventionTypeId?: string;
    title?: string;
    description?: string;
    assignedDate?: string;
    dueDate?: string;
    sortOrder?: number;
}

export interface UpdatePlanItemPayload {
    title?: string;
    description?: string;
    assignedDate?: string;
    dueDate?: string;
    completed?: boolean;
    completedDate?: string;
    sortOrder?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export const migrantUsersApi = {
    // ── Migrant users ──────────────────────────────────────────────────────────

    async listMigrants(): Promise<MigrantUser[]> {
        logger.info('[migrant-users.api] listMigrants');
        return apiGet<MigrantUser[]>('/admin/migrants/users');
    },

    async getMigrant(id: string): Promise<MigrantUser> {
        logger.info('[migrant-users.api] getMigrant', { id });
        return apiGet<MigrantUser>(`/admin/migrants/users/${id}`);
    },

    async deleteMigrant(id: string): Promise<void> {
        logger.warn('[migrant-users.api] deleteMigrant', { id });
        return apiDelete(`/admin/migrants/users/${id}`);
    },

    // ── Intervention plans ─────────────────────────────────────────────────────

    async listPlans(migrantId: string): Promise<InterventionPlan[]> {
        logger.info('[migrant-users.api] listPlans', { migrantId });
        return apiGet<InterventionPlan[]>(`/admin/migrants/${migrantId}/plans`);
    },

    async getPlan(migrantId: string, planId: string): Promise<InterventionPlan> {
        logger.info('[migrant-users.api] getPlan', { migrantId, planId });
        return apiGet<InterventionPlan>(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
    },

    async createPlan(
        migrantId: string,
        payload: CreatePlanPayload,
    ): Promise<InterventionPlan> {
        logger.info('[migrant-users.api] createPlan', { migrantId });
        return apiPost<InterventionPlan>(
            `/admin/migrants/${migrantId}/plans`,
            payload,
        );
    },

    async updatePlan(
        migrantId: string,
        planId: string,
        payload: UpdatePlanPayload,
    ): Promise<InterventionPlan> {
        logger.info('[migrant-users.api] updatePlan', { migrantId, planId });
        return apiPatch<InterventionPlan>(
            `/admin/migrants/${migrantId}/plans/${planId}`,
            payload,
        );
    },

    async deletePlan(migrantId: string, planId: string): Promise<void> {
        logger.warn('[migrant-users.api] deletePlan', { migrantId, planId });
        return apiDelete(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
    },

    // ── Plan items ─────────────────────────────────────────────────────────────

    async createItem(
        migrantId: string,
        planId: string,
        payload: CreatePlanItemPayload,
    ): Promise<InterventionPlanItem> {
        logger.info('[migrant-users.api] createItem', { migrantId, planId });
        return apiPost<InterventionPlanItem>(
            `/admin/migrants/${migrantId}/plans/${planId}/items`,
            payload,
        );
    },

    async updateItem(
        migrantId: string,
        planId: string,
        itemId: string,
        payload: UpdatePlanItemPayload,
    ): Promise<InterventionPlanItem> {
        logger.info('[migrant-users.api] updateItem', { migrantId, planId, itemId });
        return apiPatch<InterventionPlanItem>(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}`,
            payload,
        );
    },

    async requestValidation(
        migrantId: string,
        planId: string,
        itemId: string,
    ): Promise<InterventionPlanItem> {
        logger.info('[migrant-users.api] requestValidation', { itemId });
        return apiPost<InterventionPlanItem>(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}/request-validation`,
            {},
        );
    },

    async deleteItem(
        migrantId: string,
        planId: string,
        itemId: string,
    ): Promise<void> {
        logger.warn('[migrant-users.api] deleteItem', { migrantId, planId, itemId });
        return apiDelete(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}`,
        );
    },

    // ── Notes ─────────────────────────────────────────────────────────────────

    async getNotes(migrantId: string): Promise<string | null> {
        logger.info('[migrant-users.api] getNotes', { migrantId });
        const res = await apiGet<{ notes: string | null }>(
            `/admin/migrants/users/${migrantId}/notes`,
        );
        return res.notes;
    },

    async updateNotes(migrantId: string, notes: string): Promise<string> {
        logger.info('[migrant-users.api] updateNotes', { migrantId });
        const res = await apiPatch<{ notes: string }>(
            `/admin/migrants/users/${migrantId}/notes`,
            { notes },
        );
        return res.notes;
    },
};