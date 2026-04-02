/**
 * tests/api/topics.spec.ts
 *
 * Playwright API test suite for the TOPIC content endpoints.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *   Suite 1 — Full CRUD lifecycle
 *     POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET
 *
 *   Suite 2 — Parent-child hierarchy
 *     Create parent → create child with parentId → verify depth/parentId
 *     → attempt cycle → attempt delete parent (should 409)
 *     → delete child → delete parent OK
 *
 *   Suite 3 — Translation workflow
 *     POST → PUT (APPROVED) → verify STALE on non-source → publish → migrant endpoint
 *
 *   Suite 4 — Migrant frontend endpoint
 *     Unauthenticated access, lang fallback, `father` field present
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test tests/api/topics.spec.ts
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
    return request.newContext({
        baseURL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
}

// ── Suite 1: Full CRUD lifecycle ──────────────────────────────────────────────

test.describe('Topics API — CRUD lifecycle', () => {
    test('POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET', async () => {
        const api = await adminApi();

        // ── POST: create a topic ─────────────────────────────────────────────
        const postRes = await api.post('/topics', {
            data: {
                topic: 'Alloggio',
                description: 'Tutto ciò che riguarda abitazioni e residenza',
                sourceLang: 'it',
                dataExtra: { icon: 'data:image/png;base64,iVBORw0KGgo=' },
                translations: {
                    it: { title: 'Alloggio', description: 'Tutto ciò che riguarda abitazioni e residenza' },
                    en: { title: 'Housing', description: 'Everything related to housing and residence' },
                },
            },
        });
        expect(postRes.status()).toBe(200);
        const created = await postRes.json() as Record<string, unknown>;
        expect(created.id).toBeTruthy();
        expect(created.topic).toBe('Alloggio');
        expect(created.status).toBe('DRAFT');
        expect(created.parentId).toBeNull();
        expect(created.depth).toBe(0);
        const topicId = created.id as number;

        // ── GET list: topic appears ──────────────────────────────────────────
        const listRes = await api.get('/topics');
        expect(listRes.status()).toBe(200);
        const list = await listRes.json() as Array<Record<string, unknown>>;
        const inList = list.find(t => t.id === topicId);
        expect(inList).toBeTruthy();
        expect(inList!.parentId).toBeNull();
        expect(inList!.depth).toBe(0);

        // ── GET /topics/:id: full DTO ────────────────────────────────────────
        const getRes = await api.get(`/topics/${topicId}`);
        expect(getRes.status()).toBe(200);
        const full = await getRes.json() as Record<string, unknown>;
        expect(full.id).toBe(topicId);
        expect(full.status).toBe('DRAFT');
        expect(full.parentId).toBeNull();
        expect(full.depth).toBe(0);
        const translations = full.translations as Record<string, Record<string, string>>;
        expect(translations.it?.title).toBe('Alloggio');
        expect(translations.en?.title).toBe('Housing');
        const revisions = full.revisions as Array<Record<string, unknown>>;
        expect(revisions).toHaveLength(1);
        expect(revisions[0]!.revisionNo).toBe(1);

        // ── PUT: update translations + icon ──────────────────────────────────
        const putRes = await api.put(`/topics/${topicId}`, {
            data: {
                status: 'DRAFT',
                sourceLang: 'it',
                dataExtra: { icon: 'data:image/png;base64,UPDATED==' },
                translations: {
                    it: { title: 'Alloggio (aggiornato)', description: 'Descrizione aggiornata' },
                    en: { title: 'Housing (updated)', description: 'Updated description' },
                },
            },
        });
        expect(putRes.status()).toBe(204);

        // ── GET: verify update persisted ─────────────────────────────────────
        const afterPutRes = await api.get(`/topics/${topicId}`);
        const afterPut = await afterPutRes.json() as Record<string, unknown>;
        const afterTranslations = afterPut.translations as Record<string, Record<string, string>>;
        expect(afterTranslations.it?.title).toBe('Alloggio (aggiornato)');
        const afterDataExtra = afterPut.dataExtra as Record<string, string>;
        expect(afterDataExtra.icon).toContain('UPDATED');

        // ── PATCH: status toggle only ────────────────────────────────────────
        const patchRes = await api.patch(`/topics/${topicId}`, {
            data: { status: 'APPROVED' },
        });
        expect(patchRes.status()).toBe(204);

        // ── GET: verify APPROVED ─────────────────────────────────────────────
        const afterPatchRes = await api.get(`/topics/${topicId}`);
        const afterPatch = await afterPatchRes.json() as Record<string, unknown>;
        expect(afterPatch.status).toBe('APPROVED');
        // Non-source translation (en) should be STALE after approval
        const afterPatchTr = afterPatch.translations as Record<string, Record<string, string>>;
        expect(afterPatchTr.en?.tStatus).toBe('STALE');

        // ── DELETE ───────────────────────────────────────────────────────────
        const delRes = await api.delete(`/topics/${topicId}`);
        expect(delRes.status()).toBe(204);

        // ── GET after delete → 404 ───────────────────────────────────────────
        const afterDelRes = await api.get(`/topics/${topicId}`);
        expect(afterDelRes.status()).toBe(404);
    });
});

// ── Suite 2: Parent-child hierarchy ──────────────────────────────────────────

test.describe('Topics API — Parent-child hierarchy', () => {
    test('Create parent → child → verify depth → cycle prevention → delete guard → cleanup', async () => {
        const api = await adminApi();

        // Create parent (root)
        const parentRes = await api.post('/topics', {
            data: {
                topic: 'Salute',
                sourceLang: 'it',
                dataExtra: {},
                translations: { it: { title: 'Salute' } },
            },
        });
        expect(parentRes.status()).toBe(200);
        const parent = await parentRes.json() as Record<string, unknown>;
        const parentId = parent.id as number;
        expect(parent.depth).toBe(0);
        expect(parent.parentId).toBeNull();

        // Create child with parentId
        const childRes = await api.post('/topics', {
            data: {
                topic: 'Salute mentale',
                sourceLang: 'it',
                dataExtra: {},
                parentId: parentId,
                translations: { it: { title: 'Salute mentale' } },
            },
        });
        expect(childRes.status()).toBe(200);
        const child = await childRes.json() as Record<string, unknown>;
        const childId = child.id as number;
        expect(child.depth).toBe(1);
        expect(child.parentId).toBe(parentId);

        // GET child full — verify depth and parentId persisted
        const childFullRes = await api.get(`/topics/${childId}`);
        expect(childFullRes.status()).toBe(200);
        const childFull = await childFullRes.json() as Record<string, unknown>;
        expect(childFull.depth).toBe(1);
        expect(childFull.parentId).toBe(parentId);

        // GET list — both appear with correct depths
        const listRes = await api.get('/topics');
        const list = await listRes.json() as Array<Record<string, unknown>>;
        const parentInList = list.find(t => t.id === parentId);
        const childInList = list.find(t => t.id === childId);
        expect(parentInList!.depth).toBe(0);
        expect(childInList!.depth).toBe(1);
        expect(childInList!.parentId).toBe(parentId);

        // Cycle prevention: attempt to set child as parent of parent
        const cycleRes = await api.put(`/topics/${parentId}`, {
            data: {
                status: 'DRAFT',
                sourceLang: 'it',
                dataExtra: {},
                parentId: childId,  // would create a cycle
                translations: { it: { title: 'Salute' } },
            },
        });
        expect(cycleRes.status()).toBe(422);

        // Delete guard: attempt to delete parent that has a child → 409
        const deleteParentRes = await api.delete(`/topics/${parentId}`);
        expect(deleteParentRes.status()).toBe(409);

        // Delete child first, then parent
        const deleteChildRes = await api.delete(`/topics/${childId}`);
        expect(deleteChildRes.status()).toBe(204);

        const deleteParentRetryRes = await api.delete(`/topics/${parentId}`);
        expect(deleteParentRetryRes.status()).toBe(204);
    });

    test('Re-parenting: move child from one parent to another', async () => {
        const api = await adminApi();

        const p1Res = await api.post('/topics', {
            data: { topic: 'ParentA', sourceLang: 'it', dataExtra: {}, translations: { it: { title: 'ParentA' } } },
        });
        const p1 = await p1Res.json() as Record<string, unknown>;

        const p2Res = await api.post('/topics', {
            data: { topic: 'ParentB', sourceLang: 'it', dataExtra: {}, translations: { it: { title: 'ParentB' } } },
        });
        const p2 = await p2Res.json() as Record<string, unknown>;

        const childRes = await api.post('/topics', {
            data: {
                topic: 'Child', sourceLang: 'it', dataExtra: {},
                parentId: p1.id as number,
                translations: { it: { title: 'Child' } },
            },
        });
        const child = await childRes.json() as Record<string, unknown>;
        expect(child.parentId).toBe(p1.id);

        // Move child to p2 via PATCH
        const reparentRes = await api.patch(`/topics/${child.id}`, {
            data: { parentId: p2.id as number },
        });
        expect(reparentRes.status()).toBe(204);

        const afterRes = await api.get(`/topics/${child.id}`);
        const after = await afterRes.json() as Record<string, unknown>;
        expect(after.parentId).toBe(p2.id);
        expect(after.depth).toBe(1);

        // Cleanup
        await api.delete(`/topics/${child.id}`);
        await api.delete(`/topics/${p1.id}`);
        await api.delete(`/topics/${p2.id}`);
    });

    test('Remove parent (make root): set parentId to null via PATCH', async () => {
        const api = await adminApi();

        const parentRes = await api.post('/topics', {
            data: { topic: 'Root', sourceLang: 'it', dataExtra: {}, translations: { it: { title: 'Root' } } },
        });
        const parent = await parentRes.json() as Record<string, unknown>;

        const childRes = await api.post('/topics', {
            data: {
                topic: 'WillBeRoot', sourceLang: 'it', dataExtra: {},
                parentId: parent.id as number,
                translations: { it: { title: 'WillBeRoot' } },
            },
        });
        const child = await childRes.json() as Record<string, unknown>;
        expect(child.parentId).toBe(parent.id);

        // Remove parent
        const detachRes = await api.patch(`/topics/${child.id}`, { data: { parentId: null } });
        expect(detachRes.status()).toBe(204);

        const afterRes = await api.get(`/topics/${child.id}`);
        const after = await afterRes.json() as Record<string, unknown>;
        expect(after.parentId).toBeNull();
        expect(after.depth).toBe(0);

        // Cleanup
        await api.delete(`/topics/${child.id}`);
        await api.delete(`/topics/${parent.id}`);
    });
});

// ── Suite 3: Translation workflow ─────────────────────────────────────────────

test.describe('Topics API — Translation workflow', () => {
    test('APPROVED transition marks non-source translations STALE, publish promotes them', async () => {
        const api = await adminApi();

        // Create with two languages
        const postRes = await api.post('/topics', {
            data: {
                topic: 'Lavoro',
                sourceLang: 'it',
                dataExtra: {},
                translations: {
                    it: { title: 'Lavoro', description: 'Temi legati al lavoro' },
                    en: { title: 'Work', description: 'Work-related topics' },
                },
            },
        });
        const created = await postRes.json() as Record<string, unknown>;
        const topicId = created.id as number;

        // PUT with APPROVED status
        await api.put(`/topics/${topicId}`, {
            data: {
                status: 'APPROVED',
                sourceLang: 'it',
                dataExtra: {},
                translations: {
                    it: { title: 'Lavoro', description: 'Temi legati al lavoro' },
                    en: { title: 'Work', description: 'Work-related topics' },
                },
            },
        });

        // GET: en translation should be STALE, it should stay DRAFT
        const afterApproveRes = await api.get(`/topics/${topicId}`);
        const afterApprove = await afterApproveRes.json() as Record<string, unknown>;
        expect(afterApprove.status).toBe('APPROVED');
        const trs = afterApprove.translations as Record<string, Record<string, string>>;
        expect(trs.it?.tStatus).toBe('DRAFT');
        expect(trs.en?.tStatus).toBe('STALE');

        // Publish
        const publishRes = await api.get(`/topics/to-production?id=${topicId}`);
        expect(publishRes.status()).toBe(200);

        const afterPublishRes = await api.get(`/topics/${topicId}`);
        const afterPublish = await afterPublishRes.json() as Record<string, unknown>;
        expect(afterPublish.status).toBe('PUBLISHED');

        // Cleanup
        await api.delete(`/topics/${topicId}`);
    });
});

// ── Suite 4: Migrant frontend endpoint ────────────────────────────────────────

test.describe('Topics API — Migrant frontend', () => {
    test('Unauthenticated access, published only, father field present', async () => {
        const admin = await adminApi();
        const pub = await publicApi();

        // Create and publish a parent topic
        const parentRes = await admin.post('/topics', {
            data: {
                topic: 'Educazione',
                sourceLang: 'it',
                dataExtra: { icon: 'data:image/png;base64,abc=' },
                translations: {
                    it: { title: 'Educazione' },
                    en: { title: 'Education' },
                },
            },
        });
        const parent = await parentRes.json() as Record<string, unknown>;
        const parentId = parent.id as number;

        await admin.put(`/topics/${parentId}`, {
            data: { status: 'APPROVED', sourceLang: 'it', dataExtra: { icon: 'data:image/png;base64,abc=' }, translations: { it: { title: 'Educazione' } } },
        });
        await admin.get(`/topics/to-production?id=${parentId}`);

        // Migrant endpoint: unauthenticated, should return the published topic
        const migrantRes = await pub.get('/topics-migrant?defaultlang=it&currentlang=it');
        expect(migrantRes.status()).toBe(200);
        const migrantList = await migrantRes.json() as Array<Record<string, unknown>>;
        const found = migrantList.find(t => t.id === parentId);
        expect(found).toBeTruthy();
        expect(found!.topic).toBe('Educazione');
        expect(found!.father).toBeNull();
        expect(found!.icon).toBeTruthy();

        // Language fallback: request with unknown lang falls back to defaultlang
        const fallbackRes = await pub.get(`/topics-migrant?defaultlang=it&currentlang=xx`);
        expect(fallbackRes.status()).toBe(200);
        const fallbackList = await fallbackRes.json() as Array<Record<string, unknown>>;
        const fallbackFound = fallbackList.find(t => t.id === parentId);
        expect(fallbackFound).toBeTruthy();

        // Cleanup
        await admin.delete(`/topics/${parentId}`);
    });
});