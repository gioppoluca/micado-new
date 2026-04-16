/**
 * src/api/features.api.ts
 *
 * HTTP calls for the feature-flags resource.
 *
 * OpenAPI endpoints (FeatureFlagController):
 *   GET    /active-features          → string[] of enabled flagKeys (public, boot use)
 *   GET    /features-flags           → FeatureFlag[] with labels, optional ?lang=
 *   GET    /features-flags/{id}      → single FeatureFlag
 *   PATCH  /features-flags/{id}      → partial update (toggle enabled)
 *   POST   /features-flags           → create  [admin]
 *   DELETE /features-flags/{id}      → delete  [admin]
 *   GET    /features-flags/{id}/labels        → labels for one flag
 *   POST   /features-flags/{id}/labels/{lang} → upsert a label
 *   DELETE /features-flags/{id}/labels/{lang} → delete a label
 *
 * Auth: all endpoints require Bearer token except /active-features which is
 * used at boot time before Keycloak runs.
 *
 * Role visibility (PA front-office):
 *   READ  → micado_admin, micado_superadmin
 *   WRITE → micado_superadmin
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { MockRegistry, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single localised label for a feature flag */
export interface FeatureFlagLabel {
    lang: string;
    /** Display name in that language */
    label: string;
}

/** Full feature flag record as returned by GET /features-flags */
export interface FeatureFlag {
    id: number;
    /** Machine key, e.g. "FEAT_MIGRANT_LOGIN" */
    flagKey: string;
    enabled: boolean;
    labels?: FeatureFlagLabel[];
}

/** Payload for PATCH /features-flags/{id} */
export type PatchFeatureFlagPayload = Partial<Pick<FeatureFlag, 'enabled'>>;

// ─── API ─────────────────────────────────────────────────────────────────────

export const featuresApi = {
    /**
     * Returns the list of currently ENABLED feature flag keys.
     * Used at boot time — no auth required.
     * Auth: public
     */
    async listActive(): Promise<string[]> {
        logger.info('[features.api] listActive');
        const rows = await apiGet<{ features: string[] }[]>('/active-features');
        // Backend returns array of objects with a features array — flatten
        return rows.flatMap(r => r.features ?? []);
    },

    /**
     * Full flag list with labels for the given language.
     * Auth: micado_admin, micado_superadmin
     */
    async list(lang?: string): Promise<FeatureFlag[]> {
        logger.info('[features.api] list', { lang });
        return apiGet<FeatureFlag[]>('/features-flags', { params: lang ? { lang } : undefined });
    },

    /**
     * Single flag by id.
     * Auth: micado_admin, micado_superadmin
     */
    async getOne(id: number): Promise<FeatureFlag> {
        logger.info('[features.api] getOne', { id });
        return apiGet<FeatureFlag>(`/features-flags/${id}`);
    },

    /**
     * Toggle or partially update a flag.
     * Auth: micado_superadmin
     */
    async patch(id: number, payload: PatchFeatureFlagPayload): Promise<void> {
        logger.info('[features.api] patch', { id, payload });
        return apiPatch<void>(`/features-flags/${id}`, payload);
    },

    /**
     * Create a new feature flag.
     * Auth: micado_superadmin
     */
    async create(payload: Omit<FeatureFlag, 'id'>): Promise<FeatureFlag> {
        logger.info('[features.api] create', { flagKey: payload.flagKey });
        return apiPost<FeatureFlag>('/features-flags', payload);
    },

    /**
     * Delete a feature flag.
     * Auth: micado_superadmin
     */
    async remove(id: number): Promise<void> {
        logger.warn('[features.api] remove', { id });
        return apiDelete(`/features-flags/${id}`);
    },

    /**
     * Upsert a label for a specific language on a flag.
     * Auth: micado_superadmin
     */
    async upsertLabel(id: number, lang: string, label: string): Promise<void> {
        logger.info('[features.api] upsertLabel', { id, lang });
        return apiPost<void>(`/features-flags/${id}/labels/${lang}`, { label });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_FLAGS: FeatureFlag[] = [
    { id: 1, flagKey: 'FEAT_MIGRANT_LOGIN', enabled: true, labels: [{ lang: 'en', label: 'Migrant login' }] },
    { id: 2, flagKey: 'FEAT_DOCUMENTS', enabled: true, labels: [{ lang: 'en', label: 'Document upload' }] },
    { id: 3, flagKey: 'FEAT_ASSISTANT', enabled: false, labels: [{ lang: 'en', label: 'Virtual assistant' }] },
    { id: 4, flagKey: 'FEAT_TASKS', enabled: true, labels: [{ lang: 'en', label: 'Task management' }] },
    { id: 5, flagKey: 'FEAT_SERVICES', enabled: true, labels: [{ lang: 'en', label: 'Services' }] },
];

export function registerFeaturesMocks(mock: MockRegistry): void {
    // GET /active-features
    mock.onGet('/active-features').reply((): MockReplyTuple => {
        const enabled = MOCK_FLAGS.filter(f => f.enabled).map(f => f.flagKey);
        logger.debug('[mock] GET /active-features', { count: enabled.length });
        return [200, [{ features: enabled }]];
    });

    // GET /features-flags
    mock.onGet('/features-flags').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /features-flags', { count: MOCK_FLAGS.length });
        return [200, MOCK_FLAGS];
    });

    // GET /features-flags/:id
    mock.onGet(/\/features-flags\/\d+$/).reply((config): MockReplyTuple => {
        const id = Number((config.url ?? '').split('/').pop());
        const found = MOCK_FLAGS.find(f => f.id === id);
        if (!found) return [404, { error: `Feature flag ${id} not found` }];
        return [200, found];
    });

    // PATCH /features-flags/:id
    mock.onPatch(/\/features-flags\/\d+$/).reply((config): MockReplyTuple => {
        const id = Number((config.url ?? '').split('/').pop());
        const flag = MOCK_FLAGS.find(f => f.id === id);
        if (!flag) return [404, { error: `Feature flag ${id} not found` }];
        logger.debug('[mock] PATCH /features-flags', { id });
        return [200, flag];
    });

    logger.debug('[mock] features handlers registered');
}