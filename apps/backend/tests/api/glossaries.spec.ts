/**
 * tests/api/glossaries.spec.ts
 *
 * Playwright API test suite for the GLOSSARY content endpoints.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *   Suite 1 — Full CRUD lifecycle
 *     POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET
 *
 *   Suite 2 — Translation workflow
 *     POST → PUT (APPROVED) → verify STALE on non-source → publish → migrant
 *
 *   Suite 3 — Bulk create (CSV import simulation)
 *     Three sequential POSTs → verify all appear in list
 *
 *   Suite 4 — Public endpoints
 *     /glossaries-migrant (unauthenticated, published only)
 *     /glossary-items (unauthenticated, all statuses)
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test tests/api/glossaries.spec.ts
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

test.describe('Glossaries API — CRUD lifecycle', () => {
    test('POST → GET list → GET full → PUT → GET → PATCH → GET → DELETE → GET', async () => {
        const api = await adminApi();

        // ── POST: create ─────────────────────────────────────────────────────
        const postRes = await api.post('/glossaries', {
            data: {
                title: 'Permesso di soggiorno',
                description: 'Documento che **autorizza** il soggiorno sul territorio italiano.',
                sourceLang: 'it',
                translations: {
                    it: {
                        title: 'Permesso di soggiorno',
                        description: 'Documento che **autorizza** il soggiorno sul territorio italiano.',
                    },
                    en: {
                        title: 'Residence permit',
                        description: 'Document that **authorises** stay on Italian territory.',
                    },
                },
            },
        });
        expect(postRes.status()).toBe(200);
        const created = await postRes.json() as Record<string, unknown>;
        expect(created.id).toBeTruthy();
        expect(created.title).toBe('Permesso di soggiorno');
        expect(created.status).toBe('DRAFT');
        const termId = created.id as number;

        // ── GET list ─────────────────────────────────────────────────────────
        const listRes = await api.get('/glossaries');
        expect(listRes.status()).toBe(200);
        const list = await listRes.json() as Array<Record<string, unknown>>;
        const inList = list.find(g => g.id === termId);
        expect(inList).toBeTruthy();
        expect(inList!.title).toBe('Permesso di soggiorno');
        // No dataExtra on glossary items
        expect(inList!.dataExtra).toBeUndefined();

        // ── GET full ─────────────────────────────────────────────────────────
        const getRes = await api.get(`/glossaries/${termId}`);
        expect(getRes.status()).toBe(200);
        const full = await getRes.json() as Record<string, unknown>;
        expect(full.id).toBe(termId);
        expect(full.status).toBe('DRAFT');
        const translations = full.translations as Record<string, Record<string, string>>;
        expect(translations.it?.title).toBe('Permesso di soggiorno');
        expect(translations.en?.title).toBe('Residence permit');
        // Description is Markdown
        expect(translations.it?.description).toContain('**');
        const revisions = full.revisions as Array<Record<string, unknown>>;
        expect(revisions).toHaveLength(1);
        expect(revisions[0]!.revisionNo).toBe(1);

        // ── PUT: update ───────────────────────────────────────────────────────
        const putRes = await api.put(`/glossaries/${termId}`, {
            data: {
                status: 'DRAFT',
                sourceLang: 'it',
                translations: {
                    it: {
                        title: 'Permesso di soggiorno (aggiornato)',
                        description: 'Definizione aggiornata con **grassetto**.',
                    },
                    en: {
                        title: 'Residence permit (updated)',
                        description: 'Updated definition with **bold**.',
                    },
                },
            },
        });
        expect(putRes.status()).toBe(204);

        // ── GET after PUT ─────────────────────────────────────────────────────
        const afterPutRes = await api.get(`/glossaries/${termId}`);
        const afterPut = await afterPutRes.json() as Record<string, unknown>;
        const afterTrs = afterPut.translations as Record<string, Record<string, string>>;
        expect(afterTrs.it?.title).toBe('Permesso di soggiorno (aggiornato)');
        expect(afterTrs.en?.title).toBe('Residence permit (updated)');

        // ── PATCH: status toggle ──────────────────────────────────────────────
        const patchRes = await api.patch(`/glossaries/${termId}`, {
            data: { status: 'APPROVED' },
        });
        expect(patchRes.status()).toBe(204);

        // ── GET after PATCH: non-source should be STALE ───────────────────────
        const afterPatchRes = await api.get(`/glossaries/${termId}`);
        const afterPatch = await afterPatchRes.json() as Record<string, unknown>;
        expect(afterPatch.status).toBe('APPROVED');
        const afterPatchTrs = afterPatch.translations as Record<string, Record<string, string>>;
        expect(afterPatchTrs.en?.tStatus).toBe('STALE');
        expect(afterPatchTrs.it?.tStatus).toBe('DRAFT');

        // ── DELETE ────────────────────────────────────────────────────────────
        const delRes = await api.delete(`/glossaries/${termId}`);
        expect(delRes.status()).toBe(204);

        // ── GET after DELETE → 404 ─────────────────────────────────────────────
        const afterDelRes = await api.get(`/glossaries/${termId}`);
        expect(afterDelRes.status()).toBe(404);
    });
});

// ── Suite 2: Translation workflow ─────────────────────────────────────────────

test.describe('Glossaries API — Translation workflow', () => {
    test('APPROVED marks non-source STALE, publish promotes to PUBLISHED', async () => {
        const api = await adminApi();

        const postRes = await api.post('/glossaries', {
            data: {
                title: 'Contratto di locazione',
                description: 'Accordo tra proprietario e affittuario.',
                sourceLang: 'it',
                translations: {
                    it: { title: 'Contratto di locazione', description: 'Accordo tra proprietario e affittuario.' },
                    en: { title: 'Rental agreement', description: 'Agreement between landlord and tenant.' },
                },
            },
        });
        const created = await postRes.json() as Record<string, unknown>;
        const termId = created.id as number;

        // PUT with APPROVED
        await api.put(`/glossaries/${termId}`, {
            data: {
                status: 'APPROVED',
                sourceLang: 'it',
                translations: {
                    it: { title: 'Contratto di locazione', description: 'Accordo tra proprietario e affittuario.' },
                    en: { title: 'Rental agreement', description: 'Agreement between landlord and tenant.' },
                },
            },
        });

        const afterApproveRes = await api.get(`/glossaries/${termId}`);
        const afterApprove = await afterApproveRes.json() as Record<string, unknown>;
        expect(afterApprove.status).toBe('APPROVED');
        const trs = afterApprove.translations as Record<string, Record<string, string>>;
        expect(trs.it?.tStatus).toBe('DRAFT');    // source unchanged
        expect(trs.en?.tStatus).toBe('STALE');    // non-source → STALE

        // Publish
        const publishRes = await api.get(`/glossaries/to-production?id=${termId}`);
        expect(publishRes.status()).toBe(200);

        const afterPublishRes = await api.get(`/glossaries/${termId}`);
        const afterPublish = await afterPublishRes.json() as Record<string, unknown>;
        expect(afterPublish.status).toBe('PUBLISHED');

        // Cleanup
        await api.delete(`/glossaries/${termId}`);
    });
});

// ── Suite 3: Bulk create (CSV import simulation) ──────────────────────────────

test.describe('Glossaries API — Bulk create', () => {
    test('Three sequential POSTs all appear in list (simulates CSV import)', async () => {
        const api = await adminApi();
        const terms = [
            { title: 'Asilo politico', description: 'Protezione concessa a chi fugge da persecuzioni.' },
            { title: 'Carta di soggiorno', description: 'Permesso di soggiorno a tempo indeterminato.' },
            { title: 'SPRAR', description: 'Sistema di Protezione per Richiedenti Asilo e Rifugiati.' },
        ];

        const createdIds: number[] = [];
        for (const term of terms) {
            const res = await api.post('/glossaries', {
                data: { title: term.title, description: term.description, sourceLang: 'it' },
            });
            expect(res.status()).toBe(200);
            const body = await res.json() as Record<string, unknown>;
            createdIds.push(body.id as number);
        }

        // All three appear in list
        const listRes = await api.get('/glossaries');
        const list = await listRes.json() as Array<Record<string, unknown>>;
        for (const id of createdIds) {
            expect(list.some(g => g.id === id)).toBe(true);
        }

        // Cleanup
        for (const id of createdIds) {
            await api.delete(`/glossaries/${id}`);
        }
    });
});

// ── Suite 4: Public endpoints ─────────────────────────────────────────────────

test.describe('Glossaries API — Public endpoints', () => {
    test('/glossaries-migrant: unauthenticated, published only, lang fallback', async () => {
        const admin = await adminApi();
        const pub = await publicApi();

        // Create and publish a term
        const postRes = await admin.post('/glossaries', {
            data: {
                title: 'Rifugiato',
                description: 'Persona riconosciuta come rifugiata ai sensi del diritto internazionale.',
                sourceLang: 'it',
                translations: {
                    it: { title: 'Rifugiato', description: 'Persona riconosciuta come rifugiata.' },
                },
            },
        });
        const created = await postRes.json() as Record<string, unknown>;
        const termId = created.id as number;

        await admin.put(`/glossaries/${termId}`, {
            data: {
                status: 'APPROVED', sourceLang: 'it',
                translations: { it: { title: 'Rifugiato', description: 'Persona riconosciuta come rifugiata.' } },
            },
        });
        await admin.get(`/glossaries/to-production?id=${termId}`);

        // Unauthenticated access
        const migrantRes = await pub.get('/glossaries-migrant?defaultlang=it&currentlang=it');
        expect(migrantRes.status()).toBe(200);
        const migrantList = await migrantRes.json() as Array<Record<string, unknown>>;
        const found = migrantList.find(g => g.id === termId);
        expect(found).toBeTruthy();
        expect(found!.title).toBe('Rifugiato');
        expect(found!.description).toBeTruthy();
        expect(found!.lang).toBe('it');

        // Cleanup
        await admin.delete(`/glossaries/${termId}`);
    });

    test('/glossary-items: unauthenticated, returns draft + published', async () => {
        const admin = await adminApi();
        const pub = await publicApi();

        const postRes = await admin.post('/glossaries', {
            data: { title: 'Termine di test', description: 'Solo per test.', sourceLang: 'it' },
        });
        const created = await postRes.json() as Record<string, unknown>;
        const termId = created.id as number;

        // Should appear in mention picker even as DRAFT
        const pickerRes = await pub.get('/glossary-items?defaultlang=it&currentlang=it');
        expect(pickerRes.status()).toBe(200);
        const pickerList = await pickerRes.json() as Array<Record<string, unknown>>;
        const found = pickerList.find(g => g.id === termId);
        expect(found).toBeTruthy();
        expect(found!.title).toBe('Termine di test');
        expect(found!.published).toBe(false);

        // Cleanup
        await admin.delete(`/glossaries/${termId}`);
    });
});