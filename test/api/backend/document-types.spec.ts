/**
 * tests/api/document-types.spec.ts
 *
 * Playwright API test suite for the DOCUMENT_TYPE content endpoints.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *   Suite 1 — Full CRUD lifecycle
 *     POST   → GET (list) → GET (single/full) → PUT → GET → PATCH → GET → DELETE → GET
 *
 *   Suite 2 — Translation workflow
 *     POST → PUT (APPROVED) → verify translations marked STALE → publish → migrant endpoint
 *
 *   Suite 3 — Migrant frontend endpoint
 *     Verifies unauthenticated access, lang fallback, correct field projection
 *
 *   Suite 4 — Version history (revisions)
 *     Verifies revisions[] array is populated correctly on GET /document-types/:id
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test tests/api/document-types.spec.ts
 *
 * ── Token acquisition ─────────────────────────────────────────────────────────
 *
 *   export E2E_TOKEN_ADMIN=$(curl -s \
 *     -d "grant_type=password" \
 *     -d "client_id=micado-backend" \
 *     -d "username=pa-admin" \
 *     -d "password=<password>" \
 *     http://auth.localhost/realms/pa_frontoffice/protocol/openid-connect/token \
 *     | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

/** Creates an authenticated API context for PA admin operations. */
async function adminApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
}

/** Creates an unauthenticated context for public/migrant endpoint tests. */
async function publicApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
}

// ── Suite 1: Full CRUD lifecycle ──────────────────────────────────────────────

test.describe('DocumentTypes API — CRUD lifecycle', () => {
    test('POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET', async () => {
        const api = await adminApi();

        // ── POST: create a new document type ────────────────────────────────
        const postRes = await api.post('/document-types', {
            data: {
                document: 'Permesso di soggiorno',
                description: 'Documento che autorizza il soggiorno sul territorio italiano',
                sourceLang: 'it',
                dataExtra: {
                    icon: 'data:image/png;base64,iVBORw0KGgo=',
                    issuer: 'MOIT',
                    model_template: null,
                    validable: true,
                    validity_duration: 365,
                },
                translations: {
                    it: {
                        title: 'Permesso di soggiorno',
                        description: 'Documento che autorizza il soggiorno sul territorio italiano',
                    },
                    en: {
                        title: 'Residence permit',
                        description: 'Document authorising stay on Italian territory',
                    },
                },
            },
        });
        expect(postRes.ok(), `POST failed: ${await postRes.text()}`).toBeTruthy();
        const created = await postRes.json();

        // POST returns the flat legacy DTO
        expect(typeof created.id).toBe('number');
        expect(created.document).toBe('Permesso di soggiorno');
        expect(created.status).toBe('DRAFT');
        expect(created.sourceLang).toBe('it');
        expect(created.dataExtra?.validable).toBe(true);
        expect(created.dataExtra?.issuer).toBe('MOIT');

        const id: number = created.id;

        // ── GET list: item appears in list ───────────────────────────────────
        const listRes = await api.get('/document-types');
        expect(listRes.ok()).toBeTruthy();
        const list = await listRes.json();
        const inList = list.find((d: { id: number }) => d.id === id);
        expect(inList, `id ${id} not found in list`).toBeDefined();
        expect(inList.document).toBe('Permesso di soggiorno');

        // ── GET single (rich): all translations embedded ──────────────────
        const getRes1 = await api.get(`/document-types/${id}`);
        expect(getRes1.ok()).toBeTruthy();
        const full1 = await getRes1.json();

        expect(full1.id).toBe(id);
        expect(full1.status).toBe('DRAFT');
        expect(full1.sourceLang).toBe('it');

        // Both languages present from the POST translations map
        expect(full1.translations?.it?.title).toBe('Permesso di soggiorno');
        expect(full1.translations?.en?.title).toBe('Residence permit');
        expect(full1.translations?.it?.tStatus).toBe('DRAFT');

        // dataExtra preserved
        expect(full1.dataExtra?.icon).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(full1.dataExtra?.validity_duration).toBe(365);

        // revisions array present with one entry
        expect(Array.isArray(full1.revisions)).toBeTruthy();
        expect(full1.revisions.length).toBe(1);
        expect(full1.revisions[0].revisionNo).toBe(1);
        expect(full1.revisions[0].status).toBe('DRAFT');

        // ── PUT: full replace — update metadata and add Arabic ────────────
        const putRes = await api.put(`/document-types/${id}`, {
            data: {
                id,
                status: 'DRAFT',
                sourceLang: 'it',
                dataExtra: {
                    icon: 'data:image/png;base64,iVBORw0KGgo=',
                    issuer: 'MOIT',
                    model_template: 'template-v2',
                    validable: true,
                    validity_duration: 730,   // changed: 2 years
                },
                translations: {
                    it: {
                        title: 'Permesso di soggiorno (aggiornato)',
                        description: 'Versione aggiornata',
                    },
                    en: {
                        title: 'Residence permit (updated)',
                        description: 'Updated version',
                    },
                    ar: {
                        title: 'تصريح إقامة',
                        description: 'وثيقة تصريح الإقامة على الأراضي الإيطالية',
                    },
                },
            },
        });
        expect(putRes.ok(), `PUT failed: ${await putRes.text()}`).toBeTruthy();

        // ── GET after PUT: verify changes persisted ───────────────────────
        const getRes2 = await api.get(`/document-types/${id}`);
        expect(getRes2.ok()).toBeTruthy();
        const full2 = await getRes2.json();

        expect(full2.dataExtra?.validity_duration).toBe(730);
        expect(full2.dataExtra?.model_template).toBe('template-v2');
        expect(full2.translations?.it?.title).toBe('Permesso di soggiorno (aggiornato)');
        expect(full2.translations?.ar?.title).toBe('تصريح إقامة');
        // Three languages now present
        expect(Object.keys(full2.translations ?? {}).length).toBeGreaterThanOrEqual(3);

        // ── PATCH: update icon only (single-field patch) ─────────────────
        const patchRes = await api.patch(`/document-types/${id}`, {
            data: {
                dataExtra: {
                    icon: 'data:image/png;base64,UPDATED==',
                },
            },
        });
        expect(patchRes.ok(), `PATCH failed: ${await patchRes.text()}`).toBeTruthy();

        // ── GET after PATCH: icon changed, other dataExtra intact ─────────
        const getRes3 = await api.get(`/document-types/${id}`);
        const full3 = await getRes3.json();
        expect(full3.dataExtra?.icon).toBe('data:image/png;base64,UPDATED==');
        // Merging must preserve existing keys
        expect(full3.dataExtra?.validity_duration).toBe(730);

        // ── COUNT: endpoint is functional ──────────────────────────────────
        const countRes = await api.get('/document-types/count');
        expect(countRes.ok()).toBeTruthy();
        const countBody = await countRes.json();
        expect(typeof countBody.count).toBe('number');
        expect(countBody.count).toBeGreaterThanOrEqual(1);

        // ── DELETE ─────────────────────────────────────────────────────────
        const delRes = await api.delete(`/document-types/${id}`);
        expect(delRes.ok(), `DELETE failed: ${await delRes.text()}`).toBeTruthy();

        // ── GET after DELETE: 404 ──────────────────────────────────────────
        const getRes4 = await api.get(`/document-types/${id}`);
        expect(getRes4.status()).toBe(404);

        // ── List after DELETE: item gone ──────────────────────────────────
        const listRes2 = await api.get('/document-types');
        const list2 = await listRes2.json();
        expect(list2.find((d: { id: number }) => d.id === id)).toBeUndefined();
    });
});

// ── Suite 2: Translation workflow (DRAFT → APPROVED → PUBLISHED) ──────────────

test.describe('DocumentTypes API — Translation workflow', () => {
    let createdId: number;

    test.beforeAll(async () => {
        const api = await adminApi();
        const res = await api.post('/document-types', {
            data: {
                sourceLang: 'it',
                dataExtra: { validable: false },
                translations: {
                    it: { title: 'Carta d\'identità', description: 'Documento di identità' },
                    en: { title: 'Identity card', description: 'Identity document' },
                },
            },
        });
        const body = await res.json();
        createdId = body.id;
    });

    test.afterAll(async () => {
        if (createdId) {
            const api = await adminApi();
            await api.delete(`/document-types/${createdId}`);
        }
    });

    test('DRAFT → APPROVED: non-source translations become STALE', async () => {
        const api = await adminApi();

        // GET the current state
        const getRes = await api.get(`/document-types/${createdId}`);
        const current = await getRes.json();

        // PUT with status APPROVED — triggers "Send to translation"
        const putRes = await api.put(`/document-types/${createdId}`, {
            data: {
                id: createdId,
                status: 'APPROVED',
                sourceLang: current.sourceLang,
                dataExtra: current.dataExtra,
                translations: current.translations,
            },
        });
        expect(putRes.ok(), `PUT APPROVED failed: ${await putRes.text()}`).toBeTruthy();

        // GET: verify status transition
        const approvedRes = await api.get(`/document-types/${createdId}`);
        const approved = await approvedRes.json();

        expect(approved.status).toBe('APPROVED');

        // Source lang (it) stays DRAFT; non-source (en) becomes STALE
        expect(approved.translations?.it?.tStatus).toBe('DRAFT');
        expect(approved.translations?.en?.tStatus).toBe('STALE');
    });

    test('APPROVED → PUBLISHED: /to-production promotes revision', async () => {
        const api = await adminApi();

        const pubRes = await api.get(`/document-types/to-production?id=${createdId}`);
        expect(pubRes.ok(), `publish failed: ${await pubRes.text()}`).toBeTruthy();

        // GET: verify status is now PUBLISHED
        const fullRes = await api.get(`/document-types/${createdId}`);
        const full = await fullRes.json();
        expect(full.status).toBe('PUBLISHED');

        // revisions array grows: v1 ARCHIVED (if any) or v1 PUBLISHED
        const publishedRevision = full.revisions.find(
            (r: { status: string }) => r.status === 'PUBLISHED',
        );
        expect(publishedRevision).toBeDefined();
    });

    test('Editing a PUBLISHED item auto-creates new DRAFT revision (fork)', async () => {
        const api = await adminApi();

        // PATCH any field to trigger findOrCreateDraft
        const patchRes = await api.patch(`/document-types/${createdId}`, {
            data: { dataExtra: { validable: true } },
        });
        expect(patchRes.ok()).toBeTruthy();

        const fullRes = await api.get(`/document-types/${createdId}`);
        const full = await fullRes.json();

        // Should now show DRAFT (the forked revision)
        expect(full.status).toBe('DRAFT');
        // And revisions array has at least 2 entries
        expect(full.revisions.length).toBeGreaterThanOrEqual(2);
    });
});

// ── Suite 3: Migrant frontend endpoint ────────────────────────────────────────

test.describe('DocumentTypes API — Migrant endpoint', () => {
    let publishedId: number;

    test.beforeAll(async () => {
        const api = await adminApi();

        // Create and publish a document type for the migrant endpoint test
        const createRes = await api.post('/document-types', {
            data: {
                sourceLang: 'it',
                dataExtra: { validable: true, issuer: 'EU', validity_duration: 1825 },
                translations: {
                    it: { title: 'Passaporto', description: 'Documento di viaggio internazionale' },
                    en: { title: 'Passport', description: 'International travel document' },
                },
            },
        });
        const created = await createRes.json();
        publishedId = created.id;

        // Approve
        await api.put(`/document-types/${publishedId}`, {
            data: { id: publishedId, status: 'APPROVED', sourceLang: 'it', dataExtra: created.dataExtra, translations: {} },
        });

        // Publish
        await api.get(`/document-types/to-production?id=${publishedId}`);
    });

    test.afterAll(async () => {
        if (publishedId) {
            const api = await adminApi();
            await api.delete(`/document-types/${publishedId}`);
        }
    });

    test('GET /document-types-migrant — unauthenticated, returns published items', async () => {
        // Public (no token) context
        const pub = await publicApi();
        const res = await pub.get('/document-types-migrant?currentlang=it&defaultlang=it');
        expect(res.ok(), `migrant endpoint failed: ${await res.text()}`).toBeTruthy();

        const body = await res.json();
        expect(Array.isArray(body)).toBeTruthy();

        const found = body.find((d: { id: number }) => d.id === publishedId);
        expect(found, `published id ${publishedId} not in migrant response`).toBeDefined();

        // Field projection matches legacy shape
        expect(found.document).toBe('Passaporto');
        expect(found.lang).toBe('it');
        // data_extra fields are spread into the response
        expect(found.validable).toBe(true);
        expect(found.issuer).toBe('EU');
    });

    test('GET /document-types-migrant — language fallback (currentlang=ar → defaultlang=it)', async () => {
        const pub = await publicApi();
        // Arabic not translated — should fall back to Italian
        const res = await pub.get(
            `/document-types-migrant?currentlang=ar&defaultlang=it`,
        );
        expect(res.ok()).toBeTruthy();

        const body = await res.json();
        const found = body.find((d: { id: number }) => d.id === publishedId);
        // Falls back to Italian
        expect(found?.document).toBe('Passaporto');
        expect(found?.lang).toBe('it');
    });
});

// ── Suite 4: Version history ──────────────────────────────────────────────────

test.describe('DocumentTypes API — Version history (revisions[])', () => {
    test('revisions[] reflects full lifecycle: DRAFT → APPROVED → PUBLISHED', async () => {
        const api = await adminApi();

        // Create
        const createRes = await api.post('/document-types', {
            data: {
                sourceLang: 'it',
                dataExtra: { validable: false },
                translations: {
                    it: { title: 'Codice fiscale', description: 'Codice identificativo italiano' },
                },
            },
        });
        const created = await createRes.json();
        const id: number = created.id;

        try {
            // v1: DRAFT — one revision in history
            const r1 = await (await api.get(`/document-types/${id}`)).json();
            expect(r1.revisions.length).toBe(1);
            expect(r1.revisions[0]).toMatchObject({ revisionNo: 1, status: 'DRAFT' });
            expect(typeof r1.revisions[0].createdByName).toBe('string');

            // Approve
            await api.put(`/document-types/${id}`, {
                data: {
                    id,
                    status: 'APPROVED',
                    sourceLang: 'it',
                    dataExtra: created.dataExtra,
                    translations: {},
                },
            });

            // Publish
            await api.get(`/document-types/to-production?id=${id}`);

            const r2 = await (await api.get(`/document-types/${id}`)).json();
            // Still one revision (same revision promoted through states)
            expect(r2.revisions.length).toBe(1);
            const publishedRevision = r2.revisions.find(
                (r: { status: string }) => r.status === 'PUBLISHED',
            );
            expect(publishedRevision).toBeDefined();
            expect(publishedRevision.publishedAt).toBeTruthy();

            // Edit after publish → fork creates v2
            await api.patch(`/document-types/${id}`, {
                data: { dataExtra: { validable: true } },
            });

            const r3 = await (await api.get(`/document-types/${id}`)).json();
            expect(r3.revisions.length).toBe(2);
            expect(r3.revisions[0].revisionNo).toBe(1);
            expect(r3.revisions[1].revisionNo).toBe(2);
            expect(r3.revisions[1].status).toBe('DRAFT');
        } finally {
            // Always clean up
            await api.delete(`/document-types/${id}`);
        }
    });
});