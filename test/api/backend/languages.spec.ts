import { test, expect, request } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

test.describe('Languages API CRUD', () => {
    test('GET /languages/default returns the unique active default language', async () => {
        const api = await request.newContext({ baseURL });

        try {
            const response = await api.get('/languages/default');
            expect(response.status()).toBe(200);

            const language = await response.json() as {
                lang: string;
                active: boolean;
                isDefault: boolean;
            };
            expect(language.lang).toBeTruthy();
            expect(language.active).toBe(true);
            expect(language.isDefault).toBe(true);

            const listResponse = await api.get('/languages');
            expect(listResponse.status()).toBe(200);
            const languages = await listResponse.json() as Array<{
                lang: string;
                isDefault: boolean;
            }>;
            expect(languages.filter(item => item.isDefault)).toHaveLength(1);
            expect(languages.find(item => item.isDefault)?.lang).toBe(language.lang);
        } finally {
            await api.dispose();
        }
    });

    test('GET /languages/default fails when no default language is configured', async () => {
        const admin = await request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        const publicApi = await request.newContext({ baseURL });
        let originalDefaultLang: string | null = null;

        try {
            const initialResponse = await publicApi.get('/languages/default');
            expect(initialResponse.status()).toBe(200);
            const originalDefault = await initialResponse.json() as { lang: string };
            originalDefaultLang = originalDefault.lang;

            const unsetResponse = await admin.patch(`/languages/${originalDefaultLang}`, {
                data: { isDefault: false },
            });
            expect(unsetResponse.status()).toBe(204);

            const missingResponse = await publicApi.get('/languages/default');
            expect(missingResponse.status()).toBe(503);
            const error = await missingResponse.json() as {
                error?: { statusCode?: number };
            };
            expect(error.error?.statusCode).toBe(503);
        } finally {
            if (originalDefaultLang) {
                const restoreResponse = await admin.patch(`/languages/${originalDefaultLang}`, {
                    data: { isDefault: true },
                });
                expect(restoreResponse.status()).toBe(204);

                const restoredResponse = await publicApi.get('/languages/default');
                expect(restoredResponse.status()).toBe(200);
                const restored = await restoredResponse.json() as { lang: string };
                expect(restored.lang).toBe(originalDefaultLang);
            }
            await publicApi.dispose();
            await admin.dispose();
        }
    });

    test('POST -> GET -> PATCH -> GET -> DELETE -> GET', async () => {
        const api = await request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        // DB column is varchar(10): keep the unique test identifier within it.
        const lang = `e${Date.now().toString(36).slice(-8)}`;
        const createBody = {
            lang,
            isoCode: 'en-GB',
            name: 'E2E English',
            active: true,
            isDefault: false,
            sortOrder: 999,
            voiceString: 'UK English Female',
            voiceActive: true,
        };

        // POST
        const postRes = await api.post('/languages', { data: createBody });
        expect(postRes.ok()).toBeTruthy();
        const created = await postRes.json();
        expect(created.lang).toBe(lang);

        // GET
        const getRes1 = await api.get(`/languages/${lang}`);
        expect(getRes1.ok()).toBeTruthy();
        const got1 = await getRes1.json();
        expect(got1.name).toBe('E2E English');

        // PATCH only the fields being changed. A full replacement is not
        // required to verify the language update lifecycle.
        const patchRes = await api.patch(`/languages/${lang}`, {
            data: { name: 'E2E English Updated', voiceActive: false },
        });
        expect(patchRes.status()).toBe(204);

        // GET
        const getRes2 = await api.get(`/languages/${lang}`);
        expect(getRes2.ok()).toBeTruthy();
        const got2 = await getRes2.json();
        expect(got2.name).toBe('E2E English Updated');
        expect(got2.voiceActive).toBe(false);

        // DELETE
        const delRes = await api.delete(`/languages/${lang}`);
        expect(delRes.ok()).toBeTruthy();

        // GET (should 404)
        const getRes3 = await api.get(`/languages/${lang}`);
        expect(getRes3.status()).toBe(404);
    });
});
