/**
 * src/api/category.api.ts
 *
 * HTTP calls for the /categories-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /categories-migrant?subtype=information|event&defaultlang=it&currentlang=it
 *
 *   No authentication required (@authenticate.skip()).
 *
 *   Query params:
 *     subtype     'information' | 'event' | undefined  — filter by category type
 *     defaultlang string  — fallback language
 *     currentlang string  — preferred language
 *
 *   Response shape (per item):
 *     id      number  — externalKey
 *     title   string  — translated title
 *     lang    string  — actual language of the resolved translation
 *     subtype string  — 'information' | 'event' | 'both'
 *
 * ── Subtype semantics ─────────────────────────────────────────────────────────
 *
 *   Categories are shared between information items and events.
 *   subtype='both' means the category applies to both content types.
 *   Passing subtype= in the query restricts results to that subtype only.
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CategorySubtype = 'information' | 'event' | 'both';

export interface MigrantCategory {
    id: number;
    title: string;
    lang: string;
    subtype: CategorySubtype;
}

export interface CategoryMigrantParams {
    defaultlang: string;
    currentlang: string;
    subtype?: CategorySubtype;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const categoryApi = {
    /**
     * Fetch all published categories, optionally filtered by subtype.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: CategoryMigrantParams): Promise<MigrantCategory[]> {
        logger.info('[category.api] listForMigrant', params);
        return apiGet<MigrantCategory[]>('/categories-migrant', { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_CATEGORIES: MigrantCategory[] = [
    { id: 1, title: 'Legal documents', lang: 'en', subtype: 'information' },
    { id: 2, title: 'Cultural events', lang: 'en', subtype: 'event' },
    { id: 3, title: 'Community services', lang: 'en', subtype: 'both' },
];

export function registerCategoryMocks(mock: MockRegistry): void {
    mock.onGet('/categories-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        const subtype = config.params?.['subtype'] as string | undefined;
        const result = subtype
            ? MOCK_CATEGORIES.filter(c => c.subtype === subtype || c.subtype === 'both')
            : MOCK_CATEGORIES;
        logger.debug('[mock] GET /categories-migrant', { subtype, count: result.length });
        return [200, result];
    });
    logger.debug('[mock] category handlers registered');
}