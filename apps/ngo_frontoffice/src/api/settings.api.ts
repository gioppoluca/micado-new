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
    { key: 'public.appName', value: 'Micado NGO' },
    { key: 'public.supportEmail', value: 'support@micado.example.com' },
    { key: 'public.maintenanceMode', value: 'false' },
    { key: 'public.version', value: '1.0.0' },
];

export function registerSettingsMocks(mock: MockRegistry): void {
    mock.onGet('/public/settings').reply((config: MockRequestConfig): MockReplyTuple => {
        const prefix = config.params?.['prefix'] !== undefined
            ? String(config.params['prefix'])
            : 'public.';
        const result = MOCK_SETTINGS.filter(s => s.key.startsWith(prefix));
        logger.debug('[mock] GET /public/settings', { count: result.length });
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