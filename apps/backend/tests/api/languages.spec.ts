import { test, expect, request } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

test.describe('Languages API CRUD', () => {
    test('POST -> GET -> PUT -> GET -> DELETE -> GET', async () => {
        const api = await request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        const lang = `e2e_${Date.now()}`;
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

        // PUT (replace)
        const putBody = { ...createBody, name: 'E2E English Updated', voiceActive: false };
        const putRes = await api.put(`/languages/${lang}`, { data: putBody });
        expect(putRes.ok()).toBeTruthy();

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