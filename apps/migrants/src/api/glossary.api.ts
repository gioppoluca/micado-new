/**
 * src/api/glossary.api.ts
 *
 * HTTP calls for the /glossaries-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /glossaries-migrant?defaultlang=it&currentlang=it
 *
 *   No authentication required (@authenticate.skip()).
 *   Returns the full published glossary — no pagination, no filters.
 *   (The glossary is expected to be a small, flat list of terms.)
 *
 *   Response shape (per item):
 *     id          number          — externalKey
 *     title       string          — translated term label
 *     description string | null   — translated definition (Markdown)
 *     lang        string          — actual language of the resolved translation
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   The glossary store is typically loaded once at app startup (or on first
 *   visit to a glossary page) and kept in memory for the session.
 *   Components use it to render inline term tooltips via the mention system.
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MigrantGlossaryTerm {
    id: number;
    title: string;
    description: string | null;
    lang: string;
}

export interface GlossaryMigrantParams {
    defaultlang: string;
    currentlang: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const glossaryApi = {
    /**
     * Fetch all published glossary terms in the requested language.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: GlossaryMigrantParams): Promise<MigrantGlossaryTerm[]> {
        logger.info('[glossary.api] listForMigrant', params);
        return apiGet<MigrantGlossaryTerm[]>('/glossaries-migrant', { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_GLOSSARY: MigrantGlossaryTerm[] = [
    {
        id: 1,
        title: 'Residence permit',
        description: 'An official document allowing a foreign national to live in the country for a specified period.',
        lang: 'en',
    },
    {
        id: 2,
        title: 'Codice fiscale',
        description: 'The Italian tax identification code, required for most public and private services.',
        lang: 'en',
    },
    {
        id: 3,
        title: 'SPID',
        description: 'Sistema Pubblico di Identità Digitale — the Italian digital identity system for accessing public services online.',
        lang: 'en',
    },
    {
        id: 4,
        title: 'Questura',
        description: 'The local police headquarters responsible for issuing residence permits and other documents to foreign nationals.',
        lang: 'en',
    },
];

export function registerGlossaryMocks(mock: MockRegistry): void {
    mock.onGet('/glossaries-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /glossaries-migrant', config.params);
        return [200, MOCK_GLOSSARY];
    });
    logger.debug('[mock] glossary handlers registered');
}