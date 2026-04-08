/**
 * tests/api/information.spec.ts
 *
 * Playwright API test suite for INFORMATION endpoints.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *   Suite 1 — Full CRUD lifecycle (no dataExtra)
 *   Suite 2 — Relation management (category, topics, user types)
 *   Suite 3 — AND-combined filters
 *   Suite 4 — Pagination
 *   Suite 5 — Translation workflow (APPROVED → STALE → publish)
 *   Suite 6 — Public migrant endpoint
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test tests/api/information.spec.ts
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

async function adminApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
}

async function publicApi(): Promise<APIRequestContext> {
    return request.newContext({ baseURL, extraHTTPHeaders: { 'Content-Type': 'application/json' } });
}

async function createInfo(api: APIRequestContext, overrides: Record<string, unknown> = {}): Promise<number> {
    const res = await api.post('/information', {
        data: {
            title: 'Test Information',
            description: 'A **test** information item.',
            sourceLang: 'it',
            ...overrides,
        },
    });
    expect(res.status()).toBe(200);
    return (await res.json() as Record<string, unknown>).id as number;
}

async function createInfoCategory(api: APIRequestContext, title: string): Promise<number> {
    const res = await api.post('/categories', {
        data: { title, sourceLang: 'it', subtype: 'information' },
    });
    return (await res.json() as Record<string, unknown>).id as number;
}

// ── Suite 1: Full CRUD lifecycle ──────────────────────────────────────────────

test.describe('Information API — CRUD lifecycle', () => {
    test('POST → GET list → GET full → PUT → PATCH → DELETE → GET 404', async () => {
        const api = await adminApi();

        // POST
        const postRes = await api.post('/information', {
            data: {
                title: 'Permesso di soggiorno',
                description: 'Guida al **permesso di soggiorno**.',
                sourceLang: 'it',
                translations: {
                    it: { title: 'Permesso di soggiorno', description: 'Guida al **permesso di soggiorno**.' },
                    en: { title: 'Residence permit', description: 'Guide to the residence permit.' },
                },
            },
        });
        expect(postRes.status()).toBe(200);
        const created = await postRes.json() as Record<string, unknown>;
        expect(created.id).toBeTruthy();
        expect(created.title).toBe('Permesso di soggiorno');
        expect(created.status).toBe('DRAFT');
        // No dataExtra in information items
        expect(created.dataExtra).toBeUndefined();
        const infoId = created.id as number;

        // GET list — item appears
        const listRes = await api.get('/information');
        const list = await listRes.json() as Array<Record<string, unknown>>;
        expect(list.some(i => i.id === infoId)).toBe(true);

        // GET /:id — rich DTO
        const getRes = await api.get(`/information/${infoId}`);
        expect(getRes.status()).toBe(200);
        const full = await getRes.json() as Record<string, unknown>;
        expect(full.id).toBe(infoId);
        expect(full.dataExtra).toBeUndefined(); // confirmed no dataExtra
        const trs = full.translations as Record<string, Record<string, string>>;
        expect(trs.it?.title).toBe('Permesso di soggiorno');
        expect(trs.en?.title).toBe('Residence permit');
        // Description is Markdown
        expect(trs.it?.description).toContain('**');

        // PUT — update + APPROVED
        await api.put(`/information/${infoId}`, {
            data: {
                status: 'APPROVED',
                sourceLang: 'it',
                categoryId: null,
                topicIds: [],
                userTypeIds: [],
                translations: {
                    it: { title: 'Permesso di soggiorno (aggiornato)', description: 'Guida aggiornata.' },
                    en: { title: 'Residence permit (updated)', description: 'Updated guide.' },
                },
            },
        });

        // Verify STALE on non-source after APPROVED
        const afterPutRes = await api.get(`/information/${infoId}`);
        const afterPut = await afterPutRes.json() as Record<string, unknown>;
        expect(afterPut.status).toBe('APPROVED');
        const afterPutTrs = afterPut.translations as Record<string, Record<string, string>>;
        expect(afterPutTrs.it?.tStatus).toBe('DRAFT');
        expect(afterPutTrs.en?.tStatus).toBe('STALE');

        // PATCH status back to DRAFT
        await api.patch(`/information/${infoId}`, { data: { status: 'DRAFT' } });
        const afterPatchRes = await api.get(`/information/${infoId}`);
        const afterPatch = await afterPatchRes.json() as Record<string, unknown>;
        expect(afterPatch.status).toBe('DRAFT');

        // DELETE
        const delRes = await api.delete(`/information/${infoId}`);
        expect(delRes.status()).toBe(204);

        // Confirm 404
        const afterDel = await api.get(`/information/${infoId}`);
        expect(afterDel.status()).toBe(404);
    });
});

// ── Suite 2: Relation management ──────────────────────────────────────────────

test.describe('Information API — Relation management', () => {
    test('Category, topics and user types stored and replaced correctly', async () => {
        const api = await adminApi();

        const catId = await createInfoCategory(api, 'Documenti');
        const infoId = await createInfo(api);

        // Assign category + relations via PUT
        await api.put(`/information/${infoId}`, {
            data: {
                sourceLang: 'it',
                categoryId: catId,
                topicIds: [],
                userTypeIds: [],
                translations: { it: { title: 'Test', description: '' } },
            },
        });

        const fullRes = await api.get(`/information/${infoId}`);
        const full = await fullRes.json() as Record<string, unknown>;
        expect(full.categoryId).toBe(catId);
        expect(full.topicIds).toEqual([]);

        // Clear category
        await api.put(`/information/${infoId}`, {
            data: {
                sourceLang: 'it',
                categoryId: null,
                topicIds: [],
                userTypeIds: [],
                translations: { it: { title: 'Test', description: '' } },
            },
        });
        const afterClear = await (await api.get(`/information/${infoId}`)).json() as Record<string, unknown>;
        expect(afterClear.categoryId).toBeNull();

        // Cleanup
        await api.delete(`/information/${infoId}`);
        await api.delete(`/categories/${catId}`);
    });
});

// ── Suite 3: AND filters ──────────────────────────────────────────────────────

test.describe('Information API — Filters', () => {
    test('categoryId filter separates information items by category', async () => {
        const api = await adminApi();

        const cat1 = await createInfoCategory(api, 'Lavoro');
        const cat2 = await createInfoCategory(api, 'Salute');
        const id1 = await createInfo(api, { title: 'Info Lavoro' });
        const id2 = await createInfo(api, { title: 'Info Salute' });

        await api.put(`/information/${id1}`, {
            data: {
                sourceLang: 'it', categoryId: cat1, topicIds: [], userTypeIds: [],
                translations: { it: { title: 'Info Lavoro', description: '' } },
            },
        });
        await api.put(`/information/${id2}`, {
            data: {
                sourceLang: 'it', categoryId: cat2, topicIds: [], userTypeIds: [],
                translations: { it: { title: 'Info Salute', description: '' } },
            },
        });

        const filtered = await (await api.get(`/information?categoryId=${cat1}`)).json() as Array<Record<string, unknown>>;
        expect(filtered.some(i => i.id === id1)).toBe(true);
        expect(filtered.some(i => i.id === id2)).toBe(false);

        await api.delete(`/information/${id1}`);
        await api.delete(`/information/${id2}`);
        await api.delete(`/categories/${cat1}`);
        await api.delete(`/categories/${cat2}`);
    });
});

// ── Suite 4: Pagination ───────────────────────────────────────────────────────

test.describe('Information API — Pagination', () => {
    test('page + pageSize params correctly slice results', async () => {
        const api = await adminApi();
        const ids: number[] = [];
        for (let i = 0; i < 4; i++) ids.push(await createInfo(api, { title: `Info ${i}` }));

        const p1 = await (await api.get('/information?page=1&pageSize=2')).json() as unknown[];
        const p2 = await (await api.get('/information?page=2&pageSize=2')).json() as unknown[];
        expect(p1.length).toBeLessThanOrEqual(2);
        expect(p2.length).toBeLessThanOrEqual(2);
        const p1ids = (p1 as Array<Record<string, unknown>>).map(i => i.id);
        const p2ids = (p2 as Array<Record<string, unknown>>).map(i => i.id);
        expect(p1ids.filter(i => p2ids.includes(i))).toHaveLength(0);

        const count = (await (await api.get('/information/count')).json() as Record<string, number>).count;
        expect(count).toBeGreaterThanOrEqual(4);

        for (const id of ids) await api.delete(`/information/${id}`);
    });
});

// ── Suite 5: Translation workflow ─────────────────────────────────────────────

test.describe('Information API — Translation workflow', () => {
    test('APPROVED marks non-source STALE, publish promotes to PUBLISHED', async () => {
        const api = await adminApi();
        const infoId = await createInfo(api);

        await api.put(`/information/${infoId}`, {
            data: {
                status: 'APPROVED', sourceLang: 'it',
                categoryId: null, topicIds: [], userTypeIds: [],
                translations: {
                    it: { title: 'Test IT', description: '**testo**' },
                    en: { title: 'Test EN', description: '**text**' },
                },
            },
        });

        const afterApprove = await (await api.get(`/information/${infoId}`)).json() as Record<string, unknown>;
        const trs = afterApprove.translations as Record<string, Record<string, string>>;
        expect(trs.it?.tStatus).toBe('DRAFT');
        expect(trs.en?.tStatus).toBe('STALE');

        const publishRes = await api.get(`/information/to-production?id=${infoId}`);
        expect(publishRes.status()).toBe(200);

        const afterPublish = await (await api.get(`/information/${infoId}`)).json() as Record<string, unknown>;
        expect(afterPublish.status).toBe('PUBLISHED');

        await api.delete(`/information/${infoId}`);
    });
});

// ── Suite 6: Public migrant endpoint ──────────────────────────────────────────

test.describe('Information API — Migrant endpoint', () => {
    test('/information-migrant returns published items only', async () => {
        const admin = await adminApi();
        const pub = await publicApi();

        const infoId = await createInfo(admin, {
            translations: { it: { title: 'Info Pubblica', description: 'Contenuto pubblico.' } },
        });

        await admin.put(`/information/${infoId}`, {
            data: {
                status: 'APPROVED', sourceLang: 'it',
                categoryId: null, topicIds: [], userTypeIds: [],
                translations: { it: { title: 'Info Pubblica', description: 'Contenuto pubblico.' } },
            },
        });
        await admin.get(`/information/to-production?id=${infoId}`);

        const res = await pub.get('/information-migrant?defaultlang=it&currentlang=it');
        expect(res.status()).toBe(200);
        const list = await res.json() as Array<Record<string, unknown>>;
        const found = list.find(i => i.id === infoId);
        expect(found).toBeTruthy();
        expect(found!.title).toBe('Info Pubblica');
        // No dataExtra fields
        expect(found!.dataExtra).toBeUndefined();

        // DRAFT items should not appear
        const draftId = await createInfo(admin, { title: 'Bozza' });
        const res2 = await pub.get('/information-migrant?defaultlang=it&currentlang=it');
        const list2 = await res2.json() as Array<Record<string, unknown>>;
        expect(list2.some(i => i.id === draftId)).toBe(false);

        await admin.delete(`/information/${infoId}`);
        await admin.delete(`/information/${draftId}`);
    });
});