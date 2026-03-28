/**
 * tests/api/user-types.spec.ts
 *
 * Playwright API test suite for the /user-types resource.
 *
 * Coverage:
 *   POST   /user-types           create with translations map
 *   GET    /user-types/:id       UserTypeFull — all translations embedded
 *   GET    /user-types           item in list
 *   GET    /user-types/count     count ≥ 1
 *   PUT    /user-types/:id       full replace — translations updated
 *   GET    /user-types/:id       translations reflect PUT
 *   PATCH  /user-types/:id       status DRAFT → APPROVED
 *   GET    /user-types/:id       status + tStatus reflect PATCH
 *   DELETE /user-types/:id       item removed
 *   GET    /user-types/:id       404 after delete
 *
 *   Regression: POST/PUT with `translations` must NOT return 422
 *   (was broken by getModelSchemaRef $ref resolving additionalProperties:false)
 *
 * Environment variables (set in playwright.config.ts or .env):
 *   API_BASE_URL    — e.g. http://api.localhost  (default)
 *   E2E_TOKEN_ADMIN — valid PA admin Bearer token
 *
 * Run:
 *   npx playwright test tests/api/user-types.spec.ts
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

function authContext(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
}

// ─── Full CRUD cycle ──────────────────────────────────────────────────────────

test.describe('UserTypes API', () => {

    test('POST → GET → PUT → GET → PATCH → GET → DELETE → GET', async () => {
        const api = await authContext();

        // ── 1. POST /user-types — with translations map ───────────────────────
        const postRes = await api.post('/user-types', {
            data: {
                user_type: 'E2E User Type',
                description: 'Created by Playwright.',
                status: 'DRAFT',
                sourceLang: 'en',
                dataExtra: { icon: '' },
                translations: {
                    en: { title: 'E2E User Type', description: 'Created by Playwright.' },
                    it: { title: 'Tipo utente E2E', description: 'Creato da Playwright.' },
                },
            },
        });

        expect(postRes.status(), `POST failed:\n${await postRes.text()}`).toBe(200);

        const created = await postRes.json() as {
            id: number;
            user_type: string;
            status: string;
            sourceLang: string;
        };

        expect(typeof created.id).toBe('number');
        expect(created.user_type).toBe('E2E User Type');
        expect(created.status).toBe('DRAFT');
        expect(created.sourceLang).toBe('en');

        const id = created.id;

        // ── 2. GET /user-types/:id — UserTypeFull with all translations ────────
        const getRes1 = await api.get(`/user-types/${id}`);
        expect(getRes1.ok(), `GET /:id failed:\n${await getRes1.text()}`).toBeTruthy();

        const full1 = await getRes1.json() as {
            id: number;
            status: string;
            sourceLang: string;
            translations: Record<string, { title: string; description: string; tStatus: string }>;
        };

        expect(full1.id).toBe(id);
        expect(full1.status).toBe('DRAFT');
        expect(full1.translations).toHaveProperty('en');
        expect(full1.translations).toHaveProperty('it');
        expect(full1.translations['en']?.title).toBe('E2E User Type');
        expect(full1.translations['it']?.title).toBe('Tipo utente E2E');

        // ── 3. GET /user-types — list contains the new item ───────────────────
        const listRes = await api.get('/user-types');
        expect(listRes.ok()).toBeTruthy();
        const list = await listRes.json() as { id: number }[];
        expect(list.some(ut => ut.id === id)).toBe(true);

        // ── 4. GET /user-types/count — count ≥ 1 ──────────────────────────────
        const countRes = await api.get('/user-types/count');
        expect(countRes.ok()).toBeTruthy();
        const { count } = await countRes.json() as { count: number };
        expect(count).toBeGreaterThanOrEqual(1);

        // ── 5. PUT /user-types/:id — update all translations + add French ──────
        const putRes = await api.put(`/user-types/${id}`, {
            data: {
                id,
                status: 'DRAFT',
                sourceLang: 'en',
                dataExtra: { icon: '' },
                translations: {
                    en: { title: 'E2E User Type (updated)', description: 'Updated by PUT.' },
                    it: { title: 'Tipo aggiornato', description: 'Aggiornato con PUT.' },
                    fr: { title: 'Type utilisateur E2E', description: 'Ajouté par le PUT.' },
                },
            },
        });

        expect(putRes.status(), `PUT failed:\n${await putRes.text()}`).toBe(204);

        // ── 6. GET /user-types/:id — verify PUT persisted ─────────────────────
        const getRes2 = await api.get(`/user-types/${id}`);
        expect(getRes2.ok()).toBeTruthy();

        const full2 = await getRes2.json() as {
            translations: Record<string, { title: string }>;
        };

        expect(full2.translations['en']?.title).toBe('E2E User Type (updated)');
        expect(full2.translations['it']?.title).toBe('Tipo aggiornato');
        expect(full2.translations).toHaveProperty('fr');
        expect(full2.translations['fr']?.title).toBe('Type utilisateur E2E');

        // ── 7. PATCH /user-types/:id — toggle DRAFT → APPROVED ────────────────
        const patchRes = await api.patch(`/user-types/${id}`, {
            data: { status: 'APPROVED' },
        });

        expect(patchRes.status(), `PATCH failed:\n${await patchRes.text()}`).toBe(204);

        // ── 8. GET /user-types/:id — verify status + tStatus ─────────────────
        const getRes3 = await api.get(`/user-types/${id}`);
        expect(getRes3.ok()).toBeTruthy();

        const full3 = await getRes3.json() as {
            status: string;
            translations: Record<string, { tStatus: string }>;
        };

        expect(full3.status).toBe('APPROVED');
        // Source lang stays DRAFT; non-source langs become STALE
        expect(full3.translations['en']?.tStatus).toBe('DRAFT');
        expect(full3.translations['it']?.tStatus).toBe('STALE');
        expect(full3.translations['fr']?.tStatus).toBe('STALE');

        // ── 9. DELETE /user-types/:id ─────────────────────────────────────────
        const delRes = await api.delete(`/user-types/${id}`);
        expect(delRes.status(), `DELETE failed:\n${await delRes.text()}`).toBe(204);

        // ── 10. GET /user-types/:id — 404 after delete ────────────────────────
        const getRes4 = await api.get(`/user-types/${id}`);
        expect(getRes4.status()).toBe(404);

        await api.dispose();
    });

    // ─── Regression: additionalProperties validation ────────────────────────

    test('POST with translations field must not return 422', async () => {
        const api = await authContext();

        const res = await api.post('/user-types', {
            data: {
                user_type: 'Regression – additionalProperties',
                sourceLang: 'en',
                status: 'DRAFT',
                translations: {
                    en: { title: 'Regression', description: 'additionalProperties fix.' },
                },
            },
        });

        // 422 was the bug (VALIDATION_FAILED: must NOT have additional properties).
        expect(res.status(), `Expected 200, got ${res.status()}:\n${await res.text()}`).toBe(200);

        const { id } = await res.json() as { id: number };
        await api.delete(`/user-types/${id}`);
        await api.dispose();
    });

    test('PUT with translations field must not return 422', async () => {
        const api = await authContext();

        // Create a bare record first
        const postRes = await api.post('/user-types', {
            data: { user_type: 'PUT regression', sourceLang: 'en', status: 'DRAFT' },
        });
        expect(postRes.status()).toBe(200);
        const { id } = await postRes.json() as { id: number };

        // PUT with translations
        const putRes = await api.put(`/user-types/${id}`, {
            data: {
                id,
                status: 'DRAFT',
                sourceLang: 'en',
                translations: {
                    en: { title: 'PUT regression updated', description: '' },
                    ar: { title: 'تجربة', description: '' },
                },
            },
        });

        expect(putRes.status(), `Expected 204, got ${putRes.status()}:\n${await putRes.text()}`).toBe(204);

        await api.delete(`/user-types/${id}`);
        await api.dispose();
    });


    // ── Versioning: GET /:id returns revisions array ──────────────────────────

    test('GET /:id includes revisions array with at least the current revision', async () => {
        const api = await authContext();

        // Create a record
        const postRes = await api.post('/user-types', {
            data: { user_type: 'Version test', sourceLang: 'en', status: 'DRAFT' },
        });
        expect(postRes.status()).toBe(200);
        const { id } = await postRes.json() as { id: number };

        // GET full — must include revisions
        const getRes = await api.get(`/user-types/${id}`);
        expect(getRes.ok()).toBeTruthy();

        const full = await getRes.json() as {
            revisions?: Array<{ revisionNo: number; status: string; createdAt?: string }>;
        };

        // At least one revision present
        expect(Array.isArray(full.revisions)).toBe(true);
        expect(full.revisions!.length).toBeGreaterThanOrEqual(1);

        // First revision is revisionNo=1 in DRAFT
        const first = full.revisions![0]!;
        expect(first.revisionNo).toBe(1);
        expect(first.status).toBe('DRAFT');
        expect(typeof first.createdAt).toBe('string');

        await api.delete(`/user-types/${id}`);
        await api.dispose();
    });

    // ── Versioning: only one PUBLISHED at a time ──────────────────────────────

    test('publishing a new revision archives the previous PUBLISHED one', async () => {
        const api = await authContext();

        // Create + approve + publish rev 1
        const postRes = await api.post('/user-types', {
            data: {
                user_type: 'Archive test', sourceLang: 'en', status: 'DRAFT',
                translations: { en: { title: 'Archive test', description: '' } }
            },
        });
        expect(postRes.status()).toBe(200);
        const { id } = await postRes.json() as { id: number };

        await api.patch(`/user-types/${id}`, { data: { status: 'APPROVED' } });
        await api.get(`/user-types/to-production?id=${id}`);

        // Verify rev 1 is PUBLISHED
        const afterPub1 = await api.get(`/user-types/${id}`);
        const full1 = await afterPub1.json() as { revisions: Array<{ revisionNo: number; status: string }> };
        const rev1 = full1.revisions.find(r => r.revisionNo === 1);
        expect(rev1?.status).toBe('PUBLISHED');

        // Edit to create rev 2 (PATCH triggers findOrCreateDraft internally via PUT)
        const getForEdit = await api.get(`/user-types/${id}`);
        const fullForEdit = await getForEdit.json() as { sourceLang: string; dataExtra: unknown; translations: unknown };
        await api.put(`/user-types/${id}`, {
            data: {
                id,
                status: 'DRAFT',
                sourceLang: fullForEdit.sourceLang,
                dataExtra: fullForEdit.dataExtra,
                translations: { en: { title: 'Archive test v2', description: '' } },
            },
        });

        // Approve and publish rev 2
        await api.patch(`/user-types/${id}`, { data: { status: 'APPROVED' } });
        await api.get(`/user-types/to-production?id=${id}`);

        // Now rev 1 must be ARCHIVED, rev 2 must be PUBLISHED
        const afterPub2 = await api.get(`/user-types/${id}`);
        const full2 = await afterPub2.json() as { revisions: Array<{ revisionNo: number; status: string }> };

        const rev1After = full2.revisions.find(r => r.revisionNo === 1);
        const rev2After = full2.revisions.find(r => r.revisionNo === 2);

        expect(rev1After?.status).toBe('ARCHIVED');
        expect(rev2After?.status).toBe('PUBLISHED');

        // Ensure exactly one PUBLISHED revision
        const publishedCount = full2.revisions.filter(r => r.status === 'PUBLISHED').length;
        expect(publishedCount).toBe(1);

        await api.delete(`/user-types/${id}`);
        await api.dispose();
    });

});