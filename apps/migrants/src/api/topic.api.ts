/**
 * src/api/topic.api.ts
 *
 * HTTP calls for the /topics-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /topics-migrant?defaultlang=it&currentlang=it
 *
 *   No authentication required (@authenticate.skip() on the controller).
 *
 *   Response shape (per item):
 *     id          number   — externalKey (legacy numeric ID)
 *     topic       string   — translated title (falls back to defaultlang)
 *     description string   — translated description (may be Markdown)
 *     lang        string   — actual language of the returned translation
 *     icon        string | null — icon identifier from data_extra
 *     father      number | null — parent topic id (null = root)
 *
 * ── Language resolution ───────────────────────────────────────────────────────
 *
 *   The backend tries currentlang first, then falls back to defaultlang.
 *   Topics with no PUBLISHED translation in either language are omitted.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   Components never call this directly — they use useTopicMigrantStore().
 *
 * Boot order: envvar → umami → mock → i18n → axios → loadData → featureflag
 *             → keycloak → router-guard
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single topic as returned by the migrant endpoint. */
export interface MigrantTopic {
    id: number;
    /** Translated title (field is named 'topic' in the backend legacy DTO). */
    topic: string;
    description: string | null;
    /** Actual language of the resolved translation. */
    lang: string;
    /** Icon identifier (e.g. material icon name) or null. */
    icon: string | null;
    /** Parent topic id; null means this topic is a root node. */
    father: number | null;
}

export interface TopicMigrantParams {
    defaultlang: string;
    currentlang: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const topicApi = {
    /**
     * Fetch all published topics in the requested language.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: TopicMigrantParams): Promise<MigrantTopic[]> {
        logger.info('[topic.api] listForMigrant', params);
        return apiGet<MigrantTopic[]>('/topics-migrant', { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_TOPICS: MigrantTopic[] = [
    { id: 1, topic: 'Housing', description: 'Everything about finding a home.', lang: 'en', icon: 'home', father: null },
    { id: 2, topic: 'Health', description: 'Medical services and healthcare.', lang: 'en', icon: 'local_hospital', father: null },
    { id: 3, topic: 'Renting', description: 'Renting an apartment.', lang: 'en', icon: 'apartment', father: 1 },
    { id: 4, topic: 'Emergency care', description: 'Emergency medical contacts.', lang: 'en', icon: 'emergency', father: 2 },
];

export function registerTopicMocks(mock: MockRegistry): void {
    mock.onGet('/topics-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /topics-migrant', config.params);
        return [200, MOCK_TOPICS];
    });
    logger.debug('[mock] topic handlers registered');
}