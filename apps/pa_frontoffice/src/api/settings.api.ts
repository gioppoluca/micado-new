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
import { apiGet } from './client';
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
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_SETTINGS: PublicSetting[] = [
    { key: 'public.appName', value: 'Micado PA' },
    { key: 'public.supportEmail', value: 'support@micado.example.com' },
    { key: 'public.maintenanceMode', value: 'false' },
    { key: 'public.version', value: '1.0.0' },
    // ── App-bootstrap keys (read by loadData boot) ──────────────────────────
    // The value matches a `lang` primary key in the languages table.
    { key: 'default_language', value: 'en' },
    { key: 'pa_tenant', value: 'micado_pa' },
    { key: 'migrant_tenant', value: 'micado_migrant' },
    { key: 'migrant_domain_name', value: 'migrants.micado.local' },
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
        const fullKey = key.startsWith('public.') ? key : `public.${key}`;
        const found = MOCK_SETTINGS.find(s => s.key === fullKey);
        if (!found) return [404, { error: `Setting '${key}' not found` }];
        return [200, found];
    });

    logger.debug('[mock] settings handlers registered');
}