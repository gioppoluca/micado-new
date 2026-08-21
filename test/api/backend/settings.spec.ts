import { test, expect, request } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

const requiredSettingKeys = [
    'app_name',
    'pa_tenant',
    'migrant_tenant',
    'migrant_domain_name',
    'translationState',
    'internal_survey',
    'survey_local',
    'survey_en',
    'survey_pa',
    'survey_cso',
    'helpdesk_pa',
    'helpdesk_ngo',
    'helpdesk_migrant',
    'feedback_email',
    'duration_of_new',
    'topic.max_depth',
    'policy',
    'welcome.info',
    'welcome.guides',
    'welcome.event',
    'welcome.plan',
    'welcome.doc',
] as const;

test.describe('Application settings contract', () => {
    test('the clean seed declares every setting consumed by the applications', async () => {
        const api = await request.newContext({ baseURL });

        try {
            const response = await api.get('/public/settings');
            expect(response.status()).toBe(200);
            const settings = await response.json() as Array<{ key: string }>;
            const actualKeys = new Set(settings.map(setting => setting.key));

            for (const key of requiredSettingKeys) {
                expect(actualKeys.has(key), `Missing required seed setting: ${key}`).toBe(true);
            }
            expect(actualKeys.has('default_language')).toBe(false);
        } finally {
            await api.dispose();
        }
    });

    test('PATCH updates an existing declared setting', async () => {
        const api = await request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        const key = 'topic.max_depth';
        let originalValue: string | null = null;

        try {
            const initialResponse = await api.get(`/public/settings/${key}`);
            expect(initialResponse.status()).toBe(200);
            originalValue = (await initialResponse.json() as { value: string }).value;
            const testValue = originalValue === '98' ? '97' : '98';

            const patchResponse = await api.patch(`/settings/${key}`, {
                data: { value: testValue },
            });
            expect(patchResponse.status()).toBe(200);
            expect(await patchResponse.json()).toEqual({ key, value: testValue });

            const updatedResponse = await api.get(`/public/settings/${key}`);
            expect(updatedResponse.status()).toBe(200);
            expect(await updatedResponse.json()).toEqual({ key, value: testValue });
        } finally {
            if (originalValue !== null) {
                const restoreResponse = await api.patch(`/settings/${key}`, {
                    data: { value: originalValue },
                });
                expect(restoreResponse.status()).toBe(200);
            }
            await api.dispose();
        }
    });

    test('PATCH rejects an unknown key without creating it', async () => {
        const api = await request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        const key = `e2e_unknown_${Date.now()}`;

        try {
            const patchResponse = await api.patch(`/settings/${key}`, {
                data: { value: 'must-not-be-created' },
            });
            expect(patchResponse.status()).toBe(404);

            const getResponse = await api.get(`/public/settings/${key}`);
            expect(getResponse.status()).toBe(404);
        } finally {
            await api.dispose();
        }
    });
});
