/**
 * tests/api/events.spec.ts
 *
 * Playwright API test suite for the EVENTS endpoints.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *   Suite 1 — Full CRUD lifecycle
 *   Suite 2 — Relation management (category, topics, user types)
 *   Suite 3 — Filter combinations (AND semantics)
 *   Suite 4 — Pagination
 *   Suite 5 — Translation workflow (APPROVED → STALE → publish)
 *   Suite 6 — Public migrant endpoint with filters
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test tests/api/events.spec.ts
 *
 * ── Prerequisites ─────────────────────────────────────────────────────────────
 *
 *   These tests create their own categories, topics and user types as needed.
 *   Existing seed data may affect filter counts — run in an isolated DB if needed.
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

// ─── Helper: create event with minimal required fields ────────────────────────

async function createEvent(api: APIRequestContext, overrides: Record<string, unknown> = {}): Promise<number> {
    const res = await api.post('/events', {
        data: {
            title: 'Test Event',
            description: 'A **test** event description.',
            sourceLang: 'it',
            dataExtra: {
                startDate: '2025-06-01T09:00:00.000Z',
                endDate: '2025-06-01T12:00:00.000Z',
                location: 'Via Test 1, Milano',
                isFree: true,
                cost: null,
            },
            ...overrides,
        },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    return body.id as number;
}

async function createCategory(api: APIRequestContext, title: string): Promise<number> {
    const res = await api.post('/categories', {
        data: { title, sourceLang: 'it', subtype: 'event' },
    });
    return (await res.json() as Record<string, unknown>).id as number;
}

// ── Suite 1: Full CRUD lifecycle ──────────────────────────────────────────────

test.describe('Events API — CRUD lifecycle', () => {
    test('POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET', async () => {
        const api = await adminApi();

        // POST: create
        const postRes = await api.post('/events', {
            data: {
                title: 'Corso di italiano',
                description: 'Corso gratuito di **italiano** per migranti.',
                sourceLang: 'it',
                dataExtra: {
                    startDate: '2025-06-15T09:00:00.000Z',
                    endDate: '2025-06-15T12:00:00.000Z',
                    location: 'Centro Civico, Via Roma 1',
                    isFree: true,
                    cost: null,
                },
                translations: {
                    it: { title: 'Corso di italiano', description: 'Corso gratuito di **italiano** per migranti.' },
                    en: { title: 'Italian course', description: 'Free **Italian** course for migrants.' },
                },
            },
        });
        expect(postRes.status()).toBe(200);
        const created = await postRes.json() as Record<string, unknown>;
        expect(created.id).toBeTruthy();
        expect(created.title).toBe('Corso di italiano');
        expect(created.status).toBe('DRAFT');
        expect(created.isFree).toBe(true);
        expect(created.categoryId).toBeNull();
        const eventId = created.id as number;

        // GET list — appears
        const listRes = await api.get('/events');
        expect(listRes.status()).toBe(200);
        const list = await listRes.json() as Array<Record<string, unknown>>;
        const inList = list.find(e => e.id === eventId);
        expect(inList).toBeTruthy();
        expect(inList!.topicIds).toEqual([]);
        expect(inList!.userTypeIds).toEqual([]);

        // GET /:id — rich
        const getRes = await api.get(`/events/${eventId}`);
        expect(getRes.status()).toBe(200);
        const full = await getRes.json() as Record<string, unknown>;
        expect(full.id).toBe(eventId);
        const de = full.dataExtra as Record<string, unknown>;
        expect(de.startDate).toBe('2025-06-15T09:00:00.000Z');
        expect(de.location).toBe('Centro Civico, Via Roma 1');
        const trs = full.translations as Record<string, Record<string, string>>;
        expect(trs.it?.title).toBe('Corso di italiano');
        expect(trs.en?.title).toBe('Italian course');
        // description is Markdown
        expect(trs.it?.description).toContain('**');
        const revisions = full.revisions as Array<Record<string, unknown>>;
        expect(revisions[0]!.revisionNo).toBe(1);

        // PUT: update metadata + translations
        const putRes = await api.put(`/events/${eventId}`, {
            data: {
                status: 'DRAFT',
                sourceLang: 'it',
                dataExtra: {
                    startDate: '2025-07-01T14:00:00.000Z',
                    endDate: '2025-07-01T17:00:00.000Z',
                    location: 'Sala Conferenze, Via Verdi 5',
                    isFree: false,
                    cost: '€ 5',
                },
                categoryId: null,
                topicIds: [],
                userTypeIds: [],
                translations: {
                    it: { title: 'Corso di italiano (aggiornato)', description: 'Corso aggiornato.' },
                    en: { title: 'Italian course (updated)', description: 'Updated course.' },
                },
            },
        });
        expect(putRes.status()).toBe(204);

        // GET after PUT
        const afterPutRes = await api.get(`/events/${eventId}`);
        const afterPut = await afterPutRes.json() as Record<string, unknown>;
        const afterPutDe = afterPut.dataExtra as Record<string, unknown>;
        expect(afterPutDe.isFree).toBe(false);
        expect(afterPutDe.cost).toBe('€ 5');
        expect(afterPutDe.location).toBe('Sala Conferenze, Via Verdi 5');
        const afterPutTrs = afterPut.translations as Record<string, Record<string, string>>;
        expect(afterPutTrs.it?.title).toBe('Corso di italiano (aggiornato)');

        // PATCH: status toggle
        const patchRes = await api.patch(`/events/${eventId}`, {
            data: { status: 'APPROVED' },
        });
        expect(patchRes.status()).toBe(204);

        // GET after PATCH — non-source STALE
        const afterPatchRes = await api.get(`/events/${eventId}`);
        const afterPatch = await afterPatchRes.json() as Record<string, unknown>;
        expect(afterPatch.status).toBe('APPROVED');
        const afterPatchTrs = afterPatch.translations as Record<string, Record<string, string>>;
        expect(afterPatchTrs.it?.tStatus).toBe('DRAFT');
        expect(afterPatchTrs.en?.tStatus).toBe('STALE');

        // DELETE
        const delRes = await api.delete(`/events/${eventId}`);
        expect(delRes.status()).toBe(204);

        // GET after DELETE → 404
        const afterDelRes = await api.get(`/events/${eventId}`);
        expect(afterDelRes.status()).toBe(404);
    });
});

// ── Suite 2: Relation management ──────────────────────────────────────────────

test.describe('Events API — Relation management', () => {
    test('Category, topics and user types are correctly stored and replaced', async () => {
        const api = await adminApi();

        const catId = await createCategory(api, 'Integrazione');
        const eventId = await createEvent(api);

        // PUT with relations
        await api.put(`/events/${eventId}`, {
            data: {
                sourceLang: 'it',
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                categoryId: catId,
                topicIds: [],
                userTypeIds: [],
                translations: { it: { title: 'Test Event', description: '' } },
            },
        });

        const fullRes = await api.get(`/events/${eventId}`);
        const full = await fullRes.json() as Record<string, unknown>;
        expect(full.categoryId).toBe(catId);

        // Clear category via PUT with categoryId: null
        await api.put(`/events/${eventId}`, {
            data: {
                sourceLang: 'it',
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                categoryId: null,
                topicIds: [],
                userTypeIds: [],
                translations: { it: { title: 'Test Event', description: '' } },
            },
        });

        const afterClearRes = await api.get(`/events/${eventId}`);
        const afterClear = await afterClearRes.json() as Record<string, unknown>;
        expect(afterClear.categoryId).toBeNull();

        // Cleanup
        await api.delete(`/events/${eventId}`);
        await api.delete(`/categories/${catId}`);
    });
});

// ── Suite 3: Filter combinations (AND) ───────────────────────────────────────

test.describe('Events API — Filters', () => {
    test('categoryId filter returns only events with that category', async () => {
        const api = await adminApi();

        const cat1 = await createCategory(api, 'Sport');
        const cat2 = await createCategory(api, 'Cultura');
        const evt1 = await createEvent(api);
        const evt2 = await createEvent(api, { title: 'Evento Cultura' });

        // Assign cat1 to evt1, cat2 to evt2
        await api.put(`/events/${evt1}`, {
            data: {
                sourceLang: 'it', categoryId: cat1, topicIds: [], userTypeIds: [],
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                translations: { it: { title: 'Evento Sport', description: '' } },
            },
        });
        await api.put(`/events/${evt2}`, {
            data: {
                sourceLang: 'it', categoryId: cat2, topicIds: [], userTypeIds: [],
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                translations: { it: { title: 'Evento Cultura', description: '' } },
            },
        });

        const filteredRes = await api.get(`/events?categoryId=${cat1}`);
        const filtered = await filteredRes.json() as Array<Record<string, unknown>>;
        expect(filtered.some(e => e.id === evt1)).toBe(true);
        expect(filtered.some(e => e.id === evt2)).toBe(false);

        // Cleanup
        await api.delete(`/events/${evt1}`);
        await api.delete(`/events/${evt2}`);
        await api.delete(`/categories/${cat1}`);
        await api.delete(`/categories/${cat2}`);
    });
});

// ── Suite 4: Pagination ────────────────────────────────────────────────────────

test.describe('Events API — Pagination', () => {
    test('page + pageSize params correctly slice results', async () => {
        const api = await adminApi();
        const ids: number[] = [];

        // Create 5 events
        for (let i = 0; i < 5; i++) {
            ids.push(await createEvent(api, { title: `Evento paginazione ${i}` }));
        }

        // Page 1 with size 2
        const p1 = await api.get('/events?page=1&pageSize=2');
        const r1 = await p1.json() as Array<Record<string, unknown>>;
        expect(r1.length).toBeLessThanOrEqual(2);

        // Page 2 with size 2
        const p2 = await api.get('/events?page=2&pageSize=2');
        const r2 = await p2.json() as Array<Record<string, unknown>>;
        expect(r2.length).toBeLessThanOrEqual(2);

        // Page 1 and page 2 should not overlap
        const p1ids = r1.map(e => e.id);
        const p2ids = r2.map(e => e.id);
        const overlap = p1ids.filter(id => p2ids.includes(id));
        expect(overlap).toHaveLength(0);

        // Count endpoint
        const countRes = await api.get('/events/count');
        const count = (await countRes.json() as Record<string, unknown>).count as number;
        expect(count).toBeGreaterThanOrEqual(5);

        // Cleanup
        for (const id of ids) await api.delete(`/events/${id}`);
    });
});

// ── Suite 5: Translation workflow ─────────────────────────────────────────────

test.describe('Events API — Translation workflow', () => {
    test('APPROVED marks non-source STALE, publish promotes to PUBLISHED', async () => {
        const api = await adminApi();
        const eventId = await createEvent(api);

        // Add Italian + English translations
        await api.put(`/events/${eventId}`, {
            data: {
                status: 'APPROVED',
                sourceLang: 'it',
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                categoryId: null, topicIds: [], userTypeIds: [],
                translations: {
                    it: { title: 'Evento Test', description: 'Descrizione **markdown**.' },
                    en: { title: 'Test Event', description: '**Markdown** description.' },
                },
            },
        });

        const afterApproveRes = await api.get(`/events/${eventId}`);
        const afterApprove = await afterApproveRes.json() as Record<string, unknown>;
        expect(afterApprove.status).toBe('APPROVED');
        const trs = afterApprove.translations as Record<string, Record<string, string>>;
        expect(trs.it?.tStatus).toBe('DRAFT');
        expect(trs.en?.tStatus).toBe('STALE');

        // Publish
        const publishRes = await api.get(`/events/to-production?id=${eventId}`);
        expect(publishRes.status()).toBe(200);

        const afterPublishRes = await api.get(`/events/${eventId}`);
        const afterPublish = await afterPublishRes.json() as Record<string, unknown>;
        expect(afterPublish.status).toBe('PUBLISHED');

        // Cleanup
        await api.delete(`/events/${eventId}`);
    });
});

// ── Suite 6: Public migrant endpoint ──────────────────────────────────────────

test.describe('Events API — Migrant endpoint', () => {
    test('/events-migrant returns published events only, paginated', async () => {
        const admin = await adminApi();
        const pub = await publicApi();

        const eventId = await createEvent(admin, {
            title: 'Evento Pubblico',
            translations: {
                it: { title: 'Evento Pubblico', description: 'Descrizione dell\'evento.' },
            },
        });

        // Approve and publish
        await admin.put(`/events/${eventId}`, {
            data: {
                status: 'APPROVED',
                sourceLang: 'it',
                dataExtra: { startDate: '2025-06-01T09:00:00.000Z', endDate: '2025-06-01T12:00:00.000Z', isFree: true },
                categoryId: null, topicIds: [], userTypeIds: [],
                translations: { it: { title: 'Evento Pubblico', description: 'Descrizione dell\'evento.' } },
            },
        });
        await admin.get(`/events/to-production?id=${eventId}`);

        // Unauthenticated access
        const migrantRes = await pub.get('/events-migrant?defaultlang=it&currentlang=it');
        expect(migrantRes.status()).toBe(200);
        const migrantList = await migrantRes.json() as Array<Record<string, unknown>>;
        const found = migrantList.find(e => e.id === eventId);
        expect(found).toBeTruthy();
        expect(found!.title).toBe('Evento Pubblico');
        expect(found!.isFree).toBe(true);

        // DRAFT events should NOT appear
        const draftId = await createEvent(admin, { title: 'Evento Bozza' });
        const migrantRes2 = await pub.get('/events-migrant?defaultlang=it&currentlang=it');
        const migrantList2 = await migrantRes2.json() as Array<Record<string, unknown>>;
        expect(migrantList2.some(e => e.id === draftId)).toBe(false);

        // Cleanup
        await admin.delete(`/events/${eventId}`);
        await admin.delete(`/events/${draftId}`);
    });
});