/**
 * src/api/settings.api.ts
 *
 * All HTTP calls related to the /public/settings resource.
 *
 * Real endpoints (from backend PublicSettingsController):
 *   GET  /public/settings          → list all public settings (filterable by prefix)
 *   GET  /public/settings/:key     → single setting by key
 *
 * These routes are intentionally unauthenticated (public) so no Bearer token
 * is required. The apiClient still attaches one if the user is logged in,
 * which is harmless.
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPatch } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PublicSetting {
    key: string;
    value: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const settingsApi = {
    /**
     * List all settings with the given key prefix (default: 'public.').
     */
    async list(prefix?: string): Promise<PublicSetting[]> {
        logger.info('[settings.api] list', { prefix });
        return apiGet<PublicSetting[]>('/public/settings', {
            params: prefix ? { prefix } : undefined,
        });
    },

    /**
     * Fetch a single public setting by key.
     * The backend accepts both 'public.myKey' and just 'myKey'.
     */
    async getByKey(key: string): Promise<PublicSetting> {
        logger.info('[settings.api] getByKey', { key });
        return apiGet<PublicSetting>(`/public/settings/${key}`);
    },

    /**
     * Create or update a setting by key.
     * Auth: pa_editor, admin
     */
    async patch(key: string, value: string): Promise<PublicSetting> {
        logger.info('[settings.api] patch', { key });
        return apiPatch<PublicSetting>(`/settings/${key}`, { value });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_SETTINGS: PublicSetting[] = [
    { key: 'app_name', value: 'Micado PA' },
    // ── App-bootstrap keys (read by loadData boot) ──────────────────────────
    // NOTE: default_language removed — single source of truth is
    // languages.is_default in the languages table, not the settings table.
    { key: 'pa_tenant', value: 'micado_pa' },
    { key: 'migrant_tenant', value: 'micado_migrant' },
    { key: 'migrant_domain_name', value: 'migrants.micado.local' },
    // ── Survey settings ─────────────────────────────────────────────────────
    { key: 'internal_survey', value: 'false' },
    { key: 'survey_local', value: '' },
    { key: 'survey_pa', value: '' },
    { key: 'survey_cso', value: '' },
    // ── Helpdesk settings ───────────────────────────────────────────────────
    { key: 'helpdesk_pa', value: '' },
    { key: 'helpdesk_ngo', value: '' },
    { key: 'helpdesk_migrant', value: '' },
    { key: 'feedback_email', value: '' },
    { key: 'duration_of_new', value: '7' },
    {
        key: 'translationState',
        value: JSON.stringify([
            {
                value: 'editing',
                translation: [
                    { lang: 'en', state: 'Editing' },
                    { lang: 'fr', state: 'En cours' },
                    { lang: 'ar', state: 'تحرير' },
                ],
            },
            {
                value: 'translatable',
                translation: [
                    { lang: 'en', state: 'Translatable' },
                    { lang: 'fr', state: 'Traduisible' },
                    { lang: 'ar', state: 'قابل للترجمة' },
                ],
            },
            {
                value: 'translating',
                translation: [
                    { lang: 'en', state: 'Translating' },
                    { lang: 'fr', state: 'En traduction' },
                    { lang: 'ar', state: 'يترجم' },
                ],
            },
            {
                value: 'translated',
                translation: [
                    { lang: 'en', state: 'Translated' },
                    { lang: 'fr', state: 'Traduit' },
                    { lang: 'ar', state: 'مترجم' },
                ],
            },
        ]),
    },
];

export function registerSettingsMocks(mock: MockRegistry): void {
    mock.onGet('/public/settings').reply((config: MockRequestConfig): MockReplyTuple => {
        // If a prefix param was explicitly passed, filter by it.
        // If no prefix param is given (the loadData boot call), return all settings.
        const rawPrefix = config.params?.['prefix'];
        const result = rawPrefix !== undefined
            ? MOCK_SETTINGS.filter(s => s.key.startsWith(String(rawPrefix)))
            : MOCK_SETTINGS;
        logger.debug('[mock] GET /public/settings', { prefix: rawPrefix ?? '(none)', count: result.length });
        return [200, result];
    });

    mock.onGet(/\/public\/settings\/.+/).reply((config: MockRequestConfig): MockReplyTuple => {
        const key = (config.url ?? '').split('/public/settings/').pop() ?? '';
        const found = MOCK_SETTINGS.find(s => s.key === key);
        if (!found) return [404, { error: `Setting '${key}' not found` }];
        return [200, found];
    });

    mock.onPatch(/\/settings\/.+/).reply((config: MockRequestConfig): MockReplyTuple => {
        const key = (config.url ?? '').split('/settings/').pop() ?? '';
        logger.debug('[mock] PATCH /settings', { key });
        return [200, { key, value: '' }];
    });

    logger.debug('[mock] settings handlers registered');
}