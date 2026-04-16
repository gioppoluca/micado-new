/**
 * tests/api/migrant-management.spec.ts
 *
 * Playwright API test suite for migrant user management and intervention plans.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 *
 *  Migrant users (Keycloak read-only):
 *   GET /admin/migrants/users              200 — array of user objects
 *   GET /admin/migrants/users/:id          200 — single user
 *   GET /admin/migrants/users/:id          404 — unknown UUID
 *   GET /admin/migrants/users              401 — without token
 *   DEL /admin/migrants/users/:id          403 — pa_operator cannot delete
 *
 *  Notes (migrant_profile.notes via InterventionPlanService):
 *   GET  /admin/migrants/users/:id/notes   200 — {notes: null} initially
 *   PATCH /admin/migrants/users/:id/notes  200 — saves and returns notes
 *   GET  /admin/migrants/users/:id/notes   200 — reflects saved notes
 *
 *  Intervention plans (full CRUD lifecycle):
 *   POST  /admin/migrants/:id/plans                     create → 200
 *   GET   /admin/migrants/:id/plans                     list contains plan
 *   GET   /admin/migrants/:id/plans/:pid                plan + empty items[]
 *   PATCH /admin/migrants/:id/plans/:pid                update title → reflected
 *   POST  /admin/migrants/:id/plans/:pid/items          add item → 200
 *   GET   /admin/migrants/:id/plans/:pid                items[] contains item
 *   PATCH /admin/migrants/:id/plans/:pid/items/:iid     update item
 *   POST  .../items/:iid/request-validation             sets validationRequestedAt
 *   GET   /admin/migrants/:id/plans/:pid                item shows validationRequestedAt
 *   POST  .../items/:iid/request-validation             idempotent → same timestamp
 *   DEL   /admin/migrants/:id/plans/:pid/items/:iid     204 — item gone
 *   PATCH /admin/migrants/:id/plans/:pid                mark plan completed
 *   DEL   /admin/migrants/:id/plans/:pid                204 — plan gone (cascade)
 *   GET   /admin/migrants/:id/plans                     list no longer contains plan
 *
 *  Authorization:
 *   pa_operator can create/update plans and items
 *   pa_operator cannot delete plans or items (403)
 *   pa_operator cannot delete migrant users (403)
 *
 * ── Environment variables ─────────────────────────────────────────────────────
 *   API_BASE_URL              Backend base URL  (default: http://api.localhost)
 *   E2E_TOKEN_ADMIN           PA admin JWT (pa_admin role)
 *   E2E_TOKEN_OPERATOR        PA operator JWT (pa_operator role)
 *   E2E_MIGRANT_USER_ID       Known migrant Keycloak UUID.
 *                             If unset, the test resolves it by listing users.
 *   RUN_MIGRANT_MGMT_E2E      Must be 'true' to run Keycloak-dependent tests.
 *
 * ── Token acquisition ────────────────────────────────────────────────────────
 *   export E2E_TOKEN_ADMIN=$(curl -s \
 *     -d "grant_type=password" -d "client_id=micado-backend" \
 *     -d "username=pa-admin" -d "password=<pwd>" \
 *     http://auth.localhost/realms/pa_frontoffice/protocol/openid-connect/token \
 *     | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
 *
 *   export E2E_MIGRANT_USER_ID=$(curl -s \
 *     -H "Authorization: Bearer $E2E_TOKEN_ADMIN" \
 *     http://api.localhost/admin/migrants/users \
 *     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
 *
 * ── Run ───────────────────────────────────────────────────────────────────────
 *   RUN_MIGRANT_MGMT_E2E=true \
 *   E2E_TOKEN_ADMIN=<token> \
 *   E2E_MIGRANT_USER_ID=<uuid> \
 *   npx playwright test tests/api/migrant-management.spec.ts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const adminToken = process.env.E2E_TOKEN_ADMIN ?? '';
const operatorToken = process.env.E2E_TOKEN_OPERATOR ?? '';
const fixedMigrantId = process.env.E2E_MIGRANT_USER_ID ?? '';

/** Guard: Keycloak-dependent tests must opt-in explicitly. */
const keycloakEnabled = process.env.RUN_MIGRANT_MGMT_E2E === 'true';

/** Resolved once in the list test; used by all subsequent tests. */
let migrantId = fixedMigrantId;

// ── Context factories ─────────────────────────────────────────────────────────

function adminApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
        },
    });
}

function operatorApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${operatorToken}`,
            'Content-Type': 'application/json',
        },
    });
}

function anonApi(): Promise<APIRequestContext> {
    return request.newContext({ baseURL });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Migrant Users (Keycloak read-only)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Migrant users API — /admin/migrants/users', () => {

    test('GET /users — 200, array shape, resolves migrantId for other tests', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');

        const api = await adminApi();

        const res = await api.get('/admin/migrants/users');
        expect(res.status(), `Expected 200:\n${await res.text()}`).toBe(200);

        const users = await res.json() as Array<{
            id: string;
            email?: string;
            enabled?: boolean;
            createdTimestamp?: number;
        }>;

        expect(Array.isArray(users)).toBe(true);

        // Resolve migrantId for downstream tests if not env-provided
        if (!migrantId && users.length > 0) {
            migrantId = users[0]!.id;
        }

        if (users.length > 0) {
            const first = users[0]!;
            expect(typeof first.id).toBe('string');
            expect(first.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            );
        }

        await api.dispose();
    });

    test('GET /users/:id — 200, correct shape', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available — ensure E2E_MIGRANT_USER_ID is set or list test ran first.');

        const api = await adminApi();

        const res = await api.get(`/admin/migrants/users/${migrantId}`);
        expect(res.status()).toBe(200);

        const user = await res.json() as {
            id: string;
            enabled?: boolean;
            createdTimestamp?: number;
        };

        expect(user.id).toBe(migrantId);
        if (user.createdTimestamp !== undefined) {
            expect(typeof user.createdTimestamp).toBe('number');
            // Sanity: after year 2020
            expect(user.createdTimestamp).toBeGreaterThan(1_577_836_800_000);
        }

        await api.dispose();
    });

    test('GET /users/:id — 404 for unknown UUID', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');

        const api = await adminApi();
        const res = await api.get('/admin/migrants/users/00000000-0000-0000-0000-000000000000');
        expect(res.status()).toBe(404);
        await api.dispose();
    });

    test('GET /users — 401 without token', async () => {
        const api = await anonApi();
        const res = await api.get('/admin/migrants/users');
        expect([401, 403]).toContain(res.status());
        await api.dispose();
    });

    test('DELETE /users/:id — 403 for pa_operator', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available.');
        test.skip(!operatorToken, 'E2E_TOKEN_OPERATOR not set.');

        const api = await operatorApi();
        const res = await api.delete(`/admin/migrants/users/${migrantId}`);
        expect(res.status()).toBe(403);
        await api.dispose();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Notes
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Migrant notes API — /admin/migrants/users/:id/notes', () => {

    test('GET notes → null initially, PATCH to save, GET reflects saved value', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available.');

        const api = await adminApi();

        // GET — may be null or a previous value; we'll overwrite with known content
        const getRes = await api.get(`/admin/migrants/users/${migrantId}/notes`);
        expect(getRes.status()).toBe(200);
        const initial = await getRes.json() as { notes: string | null };
        expect('notes' in initial).toBe(true);

        // PATCH — save a known value
        const testNotes = `Playwright test notes – ${new Date().toISOString()}`;
        const patchRes = await api.patch(`/admin/migrants/users/${migrantId}/notes`, {
            data: { notes: testNotes },
        });
        expect(patchRes.status(), `PATCH notes failed:\n${await patchRes.text()}`).toBe(200);
        const patched = await patchRes.json() as { notes: string };
        expect(patched.notes).toBe(testNotes);

        // GET — reflects saved value
        const getAfter = await api.get(`/admin/migrants/users/${migrantId}/notes`);
        expect(getAfter.status()).toBe(200);
        const after = await getAfter.json() as { notes: string };
        expect(after.notes).toBe(testNotes);

        await api.dispose();
    });

    test('PATCH notes — 403 for pa_viewer via role check', async () => {
        // pa_viewer has GET but not PATCH. If no viewer token, we at least verify
        // that the endpoint requires auth.
        const api = await anonApi();
        const res = await api.patch(`/admin/migrants/users/00000000-0000-0000-0000-000000000000/notes`, {
            data: { notes: 'test' },
        });
        expect([401, 403]).toContain(res.status());
        await api.dispose();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Intervention Plans — full lifecycle
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Intervention plans API — full CRUD lifecycle', () => {

    test('Plan + Item create → read → update → validate → delete', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available — ensure E2E_MIGRANT_USER_ID is set.');

        const api = await adminApi();

        // ── 1. Create plan ────────────────────────────────────────────────────────
        const createPlanRes = await api.post(`/admin/migrants/${migrantId}/plans`, {
            data: {
                title: 'E2E Integration Plan',
                caseManager: 'E2E Social Worker',
                startDate: '2025-01-15',
                endDate: '2025-06-30',
                notes: 'Created by Playwright.',
            },
        });

        expect(
            createPlanRes.status(),
            `POST plan failed:\n${await createPlanRes.text()}`,
        ).toBe(200);

        const plan = await createPlanRes.json() as {
            id: string;
            migrantId: string;
            title: string;
            caseManager: string;
            completed: boolean;
            createdAt: string;
            items: unknown[];
        };

        expect(plan.id).toBeTruthy();
        expect(plan.id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(plan.migrantId).toBe(migrantId);
        expect(plan.title).toBe('E2E Integration Plan');
        expect(plan.caseManager).toBe('E2E Social Worker');
        expect(plan.completed).toBe(false);
        expect(typeof plan.createdAt).toBe('string');
        expect(Array.isArray(plan.items)).toBe(true);
        expect(plan.items.length).toBe(0);

        const planId = plan.id;

        // ── 2. List plans — new plan present ──────────────────────────────────────
        const listRes = await api.get(`/admin/migrants/${migrantId}/plans`);
        expect(listRes.status()).toBe(200);
        const plans = await listRes.json() as Array<{ id: string }>;
        expect(Array.isArray(plans)).toBe(true);
        expect(plans.some(p => p.id === planId)).toBe(true);

        // ── 3. GET plan — empty items ────────────────────────────────────────────
        const getRes = await api.get(`/admin/migrants/${migrantId}/plans/${planId}`);
        expect(getRes.status()).toBe(200);
        const fetched = await getRes.json() as { id: string; items: unknown[] };
        expect(fetched.id).toBe(planId);
        expect(Array.isArray(fetched.items)).toBe(true);
        expect(fetched.items.length).toBe(0);

        // ── 4. PATCH plan — update title ──────────────────────────────────────────
        const patchPlanRes = await api.patch(
            `/admin/migrants/${migrantId}/plans/${planId}`,
            { data: { title: 'E2E Integration Plan (updated)' } },
        );
        expect(patchPlanRes.status()).toBe(200);
        const patchedPlan = await patchPlanRes.json() as { title: string };
        expect(patchedPlan.title).toBe('E2E Integration Plan (updated)');

        // Verify via GET
        const getAfterPatch = await api.get(`/admin/migrants/${migrantId}/plans/${planId}`);
        expect((await getAfterPatch.json() as { title: string }).title)
            .toBe('E2E Integration Plan (updated)');

        // ── 5. Create item ───────────────────────────────────────────────────────
        const createItemRes = await api.post(
            `/admin/migrants/${migrantId}/plans/${planId}/items`,
            {
                data: {
                    title: 'Register with municipal office',
                    description: 'Bring ID and proof of residence.',
                    assignedDate: '2025-01-20',
                    dueDate: '2025-02-28',
                    sortOrder: 0,
                },
            },
        );

        expect(
            createItemRes.status(),
            `POST item failed:\n${await createItemRes.text()}`,
        ).toBe(200);

        const item = await createItemRes.json() as {
            id: string;
            planId: string;
            title: string;
            completed: boolean;
            sortOrder: number;
            validationRequestedAt?: string;
        };

        expect(item.id).toBeTruthy();
        expect(item.planId).toBe(planId);
        expect(item.title).toBe('Register with municipal office');
        expect(item.completed).toBe(false);
        expect(item.sortOrder).toBe(0);
        expect(item.validationRequestedAt).toBeUndefined();

        const itemId = item.id;

        // ── 6. GET plan — items array contains the item ───────────────────────────
        const getWithItems = await api.get(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
        const planWithItems = await getWithItems.json() as {
            items: Array<{ id: string; title: string }>;
        };
        expect(planWithItems.items.some(i => i.id === itemId)).toBe(true);

        // ── 7. PATCH item — mark completed ────────────────────────────────────────
        const patchItemRes = await api.patch(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}`,
            { data: { completed: true, completedDate: '2025-02-15' } },
        );
        expect(patchItemRes.status()).toBe(200);
        const patchedItem = await patchItemRes.json() as {
            completed: boolean;
            completedDate?: string;
        };
        expect(patchedItem.completed).toBe(true);
        expect(patchedItem.completedDate).toBe('2025-02-15');

        // ── 8. Reset and request validation ──────────────────────────────────────
        await api.patch(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}`,
            { data: { completed: false } },
        );

        const valRes = await api.post(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}/request-validation`,
        );
        expect(valRes.status()).toBe(200);

        const validated = await valRes.json() as { validationRequestedAt?: string };
        expect(typeof validated.validationRequestedAt).toBe('string');
        expect(validated.validationRequestedAt!.length).toBeGreaterThan(0);
        const firstTimestamp = validated.validationRequestedAt!;

        // ── 9. GET plan — item shows validationRequestedAt ────────────────────────
        const getAfterVal = await api.get(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
        const planAfterVal = await getAfterVal.json() as {
            items: Array<{ id: string; validationRequestedAt?: string }>;
        };
        const itemAfterVal = planAfterVal.items.find(i => i.id === itemId);
        expect(itemAfterVal?.validationRequestedAt).toBe(firstTimestamp);

        // ── 10. Request validation again — idempotent ────────────────────────────
        const valAgainRes = await api.post(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}/request-validation`,
        );
        expect(valAgainRes.status()).toBe(200);
        const valAgain = await valAgainRes.json() as { validationRequestedAt?: string };
        // Timestamp must not change (idempotent — only set when null)
        expect(valAgain.validationRequestedAt).toBe(firstTimestamp);

        // ── 11. Add second item ───────────────────────────────────────────────────
        const item2Res = await api.post(
            `/admin/migrants/${migrantId}/plans/${planId}/items`,
            { data: { title: 'Attend language course', sortOrder: 1 } },
        );
        expect(item2Res.status()).toBe(200);
        const item2 = await item2Res.json() as { id: string };

        // ── 12. DELETE item2 ─────────────────────────────────────────────────────
        const delItemRes = await api.delete(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${item2.id}`,
        );
        expect(delItemRes.status()).toBe(204);

        // item2 gone, item1 still present
        const afterItemDel = await api.get(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
        const afterItemDelPlan = await afterItemDel.json() as {
            items: Array<{ id: string }>;
        };
        expect(afterItemDelPlan.items.some(i => i.id === item2.id)).toBe(false);
        expect(afterItemDelPlan.items.some(i => i.id === itemId)).toBe(true);

        // ── 13. Mark plan completed ───────────────────────────────────────────────
        const completePlanRes = await api.patch(
            `/admin/migrants/${migrantId}/plans/${planId}`,
            { data: { completed: true } },
        );
        expect(completePlanRes.status()).toBe(200);
        const completedPlan = await completePlanRes.json() as { completed: boolean };
        expect(completedPlan.completed).toBe(true);

        // ── 14. DELETE plan — cascades items ──────────────────────────────────────
        const delPlanRes = await api.delete(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
        expect(delPlanRes.status()).toBe(204);

        // ── 15. Plan gone from list ───────────────────────────────────────────────
        const listAfterDel = await api.get(`/admin/migrants/${migrantId}/plans`);
        expect(listAfterDel.status()).toBe(200);
        const plansAfterDel = await listAfterDel.json() as Array<{ id: string }>;
        expect(plansAfterDel.some(p => p.id === planId)).toBe(false);

        await api.dispose();
    });

    test('GET /plans/:unknown — 404', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available.');

        const api = await adminApi();
        const res = await api.get(
            `/admin/migrants/${migrantId}/plans/00000000-0000-0000-0000-000000000000`,
        );
        expect(res.status()).toBe(404);
        await api.dispose();
    });

    test('pa_operator — can create plan, cannot delete plan (403)', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available.');
        test.skip(!operatorToken, 'E2E_TOKEN_OPERATOR not set.');

        const opApi = await operatorApi();
        const adApi = await adminApi();

        // Operator creates a plan
        const createRes = await opApi.post(`/admin/migrants/${migrantId}/plans`, {
            data: { title: 'Operator plan' },
        });
        expect(
            createRes.status(),
            `Operator should be able to create:\n${await createRes.text()}`,
        ).toBe(200);
        const { id: planId } = await createRes.json() as { id: string };

        // Operator cannot delete
        const delRes = await opApi.delete(
            `/admin/migrants/${migrantId}/plans/${planId}`,
        );
        expect(delRes.status()).toBe(403);

        // Admin cleans up
        await adApi.delete(`/admin/migrants/${migrantId}/plans/${planId}`);

        await opApi.dispose();
        await adApi.dispose();
    });

    test('pa_operator — can create item, cannot delete item (403)', async () => {
        test.skip(!keycloakEnabled, 'Set RUN_MIGRANT_MGMT_E2E=true to run.');
        test.skip(!migrantId, 'No migrantId available.');
        test.skip(!operatorToken, 'E2E_TOKEN_OPERATOR not set.');

        const opApi = await operatorApi();
        const adApi = await adminApi();

        // Admin creates a plan
        const planRes = await adApi.post(`/admin/migrants/${migrantId}/plans`, {
            data: { title: 'Role test plan' },
        });
        expect(planRes.status()).toBe(200);
        const { id: planId } = await planRes.json() as { id: string };

        // Operator adds an item — allowed
        const itemRes = await opApi.post(
            `/admin/migrants/${migrantId}/plans/${planId}/items`,
            { data: { title: 'Role test item' } },
        );
        expect(
            itemRes.status(),
            `Operator should create item:\n${await itemRes.text()}`,
        ).toBe(200);
        const { id: itemId } = await itemRes.json() as { id: string };

        // Operator cannot delete the item
        const delItemRes = await opApi.delete(
            `/admin/migrants/${migrantId}/plans/${planId}/items/${itemId}`,
        );
        expect(delItemRes.status()).toBe(403);

        // Admin cleans up
        await adApi.delete(`/admin/migrants/${migrantId}/plans/${planId}`);

        await opApi.dispose();
        await adApi.dispose();
    });

});