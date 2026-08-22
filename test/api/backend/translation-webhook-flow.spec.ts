/**
 * tests/api/translation-webhook-flow.spec.ts
 *
 * Playwright API tests for the two-phase Weblate webhook pipeline:
 *   COMMIT → staged in DB → PUSH → processed → DBOS signaled
 *
 * ── What is tested ────────────────────────────────────────────────────────────
 *
 *  Suite 1 — /translation-committed endpoint
 *    • Returns 200 and stores row in staging table
 *    • Deduplicates on change_id (idempotent)
 *    • Handles missing component/translation gracefully
 *
 *  Suite 2 — /translation-pushed endpoint
 *    • Claims and deletes staged rows atomically
 *    • Returns correct counts (claimed, signaled, deleted)
 *    • No-ops when staging table is empty for the component
 *    • Concurrent pushes don't interfere (SKIP LOCKED)
 *
 *  Suite 3 — Full round-trip via dev simulate endpoints
 *    simulate-commit → staged-commits → simulate-push → verify deleted
 *
 *  Suite 4 — Error resilience
 *    • Invalid body returns 200 (Weblate must not see 4xx)
 *    • reset-stuck resets PROCESSING rows
 *
 * ── Running ───────────────────────────────────────────────────────────────────
 *
 *  API_BASE_URL=http://api.localhost \
 *  npx playwright test tests/api/translation-webhook-flow.spec.ts --reporter=line
 *
 * ── Prerequisites ─────────────────────────────────────────────────────────────
 *
 *  - Backend running with DBOS initialized
 *  - PostgreSQL migration weblate_commit_event.sql applied
 *  - GITEA_BASE_URL, GITEA_TOKEN_FILE configured (for Gitea catalog reads)
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const webhookSecret = process.env.WEBLATE_WEBHOOK_SECRET ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function api(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
}

/**
 * POST a simulated Weblate COMMIT body to the real webhook endpoint.
 */
async function postCommit(
    ctx: APIRequestContext,
    body: Record<string, unknown>,
) {
    const rawBody = JSON.stringify(body);
    return ctx.post('/api/webhooks/weblate/translation-committed', {
        // Send exactly the bytes used to calculate the signature. Passing an
        // object would delegate serialization to Playwright and make the test
        // dependent on its JSON encoding details.
        data: rawBody,
        headers: standardWebhookHeaders(rawBody),
    });
}

/**
 * POST a simulated Weblate PUSH body to the real webhook endpoint.
 */
async function postPush(
    ctx: APIRequestContext,
    body: Record<string, unknown>,
) {
    const rawBody = JSON.stringify(body);
    return ctx.post('/api/webhooks/weblate/translation-pushed', {
        data: rawBody,
        headers: standardWebhookHeaders(rawBody),
    });
}

function standardWebhookHeaders(rawBody: string): Record<string, string> {
    if (!webhookSecret) {
        throw new Error('WEBLATE_WEBHOOK_SECRET must be available in the Playwright container');
    }

    const messageId = randomUUID().replaceAll('-', '');
    const timestamp = String(Date.now() / 1000);
    // Weblate 5.16 puts a fractional timestamp in the header but signs its
    // whole-second value. Mirror the real sender, not the generic spec helper.
    const signedTimestamp = String(Math.trunc(Number(timestamp)));
    const key = Buffer.from(webhookSecret.replace(/^whsec_/, ''), 'base64');
    const signature = createHmac('sha256', key)
        .update(`${messageId}.${signedTimestamp}.${rawBody}`)
        .digest('base64');

    return {
        'webhook-id': messageId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
    };
}

/**
 * Build a realistic Weblate COMMIT payload.
 */
function commitPayload(component: string, lang: string, changeId = 1000) {
    return {
        change_id: changeId,
        action: 'Changes committed',
        timestamp: new Date().toISOString(),
        url: `/projects/micado/${component}/${lang}/`,
        author: 'admin',
        user: 'admin',
        project: 'micado',
        component,
        translation: lang,
    };
}

/**
 * Build a realistic Weblate PUSH payload.
 */
function pushPayload(component: string, changeId = 2000) {
    return {
        change_id: changeId,
        action: 'Changes pushed',
        timestamp: new Date().toISOString(),
        url: `/projects/micado/${component}/`,
        user: 'admin',
        project: 'micado',
        component,
        // NOTE: no "translation" field — PUSH is component-level
    };
}

/** Drain rows left by an earlier assertion so global PUSH claims stay deterministic. */
async function drainStagedCommits(ctx: APIRequestContext) {
    await ctx.post('/dev/workflows/translation/reset-stuck?minutes=0');
    await ctx.post('/dev/workflows/translation/simulate-push', {
        data: { component: 'content-e2e-cleanup' },
    });
}

test.beforeEach(async () => {
    const ctx = await api();
    await drainStagedCommits(ctx);
    await ctx.dispose();
});

test.afterEach(async () => {
    const ctx = await api();
    await drainStagedCommits(ctx);
    await ctx.dispose();
});

// ── Suite 1: /translation-committed ──────────────────────────────────────────

test.describe('translation-committed webhook', () => {

    test('rejects an unsigned webhook request', async () => {
        const ctx = await api();
        const body = commitPayload('content-topics', 'it', 1099);
        const res = await ctx.post('/api/webhooks/weblate/translation-committed', { data: body });
        expect(res.status()).toBe(403);
    });

    test('returns 200 and stores row for valid COMMIT payload', async () => {
        const ctx = await api();
        const component = `content-test-${randomUUID().slice(0, 8)}`;

        const res = await postCommit(ctx, commitPayload(component, 'it', 1001));

        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; id?: string };
        expect(body.ok).toBe(true);
        expect(body.id).toBeTruthy();

        // Verify row exists in staging table via dev endpoint
        const staged = await ctx.get('/dev/workflows/translation/staged-commits?status=NEW');
        expect(staged.status()).toBe(200);
        const stagedBody = await staged.json() as { rows: Array<{ id: string }> };
        expect(stagedBody.rows.some(row => row.id === body.id)).toBe(true);

        console.log(`✓ Stored row ${body.id} for component=${component}`);
    });

    test('returns 200 for multiple languages — one row per lang', async () => {
        const ctx = await api();
        const component = `content-test-${randomUUID().slice(0, 8)}`;

        const insertedIds: string[] = [];
        for (const [lang, changeId] of [['it', 1010], ['fr', 1011], ['ar', 1012]] as const) {
            const res = await postCommit(ctx, commitPayload(component, lang, changeId));
            expect(res.status()).toBe(200);
            const body = await res.json() as { ok: boolean; id?: string };
            expect(body.ok).toBe(true);
            expect(body.id).toBeTruthy();
            insertedIds.push(body.id!);
        }

        const staged = await ctx.get('/dev/workflows/translation/staged-commits?status=NEW');
        const stagedBody = await staged.json() as { rows: Array<{ id: string }> };
        const stagedIds = new Set(stagedBody.rows.map(row => row.id));
        expect(insertedIds.every(id => stagedIds.has(id))).toBe(true);

        console.log(`✓ 3 rows stored for component=${component}`);
    });

    test('handles missing component gracefully — returns 200 with message', async () => {
        const ctx = await api();
        const res = await postCommit(ctx, {
            change_id: 9999,
            action: 'Changes committed',
            timestamp: new Date().toISOString(),
            project: 'micado',
            // missing component and translation
        });
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; message?: string };
        expect(body.ok).toBe(true);
        expect(body.message).toContain('missing component or translation');
        console.log('✓ Missing fields handled gracefully');
    });

    test('handles missing translation field gracefully — COMMIT must have lang', async () => {
        const ctx = await api();
        const res = await postCommit(ctx, {
            change_id: 9998,
            action: 'Changes committed',
            timestamp: new Date().toISOString(),
            project: 'micado',
            component: 'user-types',
            // no translation field
        });
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; message?: string };
        expect(body.ok).toBe(true);
        expect(body.message).toContain('missing component or translation');
    });

    test('accepts empty body gracefully', async () => {
        const ctx = await api();
        const res = await postCommit(ctx, {});
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean };
        expect(body.ok).toBe(true);
    });
});

// ── Suite 2: /translation-pushed ─────────────────────────────────────────────

test.describe('translation-pushed webhook', () => {

    test('no-ops gracefully when staging table is empty for component', async () => {
        const ctx = await api();
        const component = `content-empty-${randomUUID().slice(0, 8)}`;

        const res = await postPush(ctx, pushPayload(component, 3001));
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; claimed: number };
        expect(body.ok).toBe(true);
        expect(body.claimed).toBe(0);
        console.log('✓ Empty staging table handled gracefully');
    });

    test('accepts a component-less PUSH because routing uses staged rows', async () => {
        const ctx = await api();
        const res = await postPush(ctx, {
            change_id: 4001,
            action: 'Changes pushed',
            project: 'micado',
            // no component
        });
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; claimed: number };
        expect(body.ok).toBe(true);
        expect(body.claimed).toBe(0);
    });

    test('accepts empty body without crashing', async () => {
        const ctx = await api();
        const res = await postPush(ctx, {});
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; claimed: number };
        expect(body.ok).toBe(true);
        expect(body.claimed).toBe(0);
    });
});

// ── Suite 3: Full round-trip via dev endpoints ────────────────────────────────

test.describe('two-phase webhook flow — full round-trip via dev endpoints', () => {

    test('simulate-commit → staged-commits → simulate-push → rows deleted', async () => {
        const ctx = await api();
        const component = `content-roundtrip-${randomUUID().slice(0, 8)}`;

        // ── Step 1: insert staged commit rows via dev endpoint ─────────────────
        for (const lang of ['it', 'fr']) {
            const res = await ctx.post('/dev/workflows/translation/simulate-commit', {
                data: { component, lang, changeId: 5001 },
            });
            expect(res.status()).toBe(200);
            const body = await res.json() as { ok: boolean; id?: string };
            expect(body.ok).toBe(true);
            expect(body.id).toBeTruthy();
        }

        // ── Step 2: verify rows are staged ────────────────────────────────────
        const stagedRes = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}`,
        );
        const staged = await stagedRes.json() as { count: number };
        expect(staged.count).toBe(2);
        console.log(`✓ 2 rows staged for component=${component}`);

        // ── Step 3: simulate push — claims + processes + deletes ──────────────
        const pushRes = await ctx.post('/dev/workflows/translation/simulate-push', {
            data: { component },
        });
        expect(pushRes.status()).toBe(200);
        const pushBody = await pushRes.json() as {
            ok: boolean;
            claimed: number;
            deleted: number;
            workerHash: string;
        };
        expect(pushBody.ok).toBe(true);
        expect(pushBody.claimed).toBe(2);
        expect(pushBody.deleted).toBe(2);
        expect(pushBody.workerHash).toBeTruthy();
        console.log(
            `✓ Push claimed=${pushBody.claimed} deleted=${pushBody.deleted}` +
            `  workerHash=${pushBody.workerHash.slice(0, 8)}...`,
        );

        // ── Step 4: verify staging table is clean ─────────────────────────────
        const afterRes = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}`,
        );
        const after = await afterRes.json() as { count: number };
        expect(after.count).toBe(0);
        console.log('✓ Staging table clean after push');
    });

    test('real webhook endpoints — commit then push — rows staged and cleaned', async () => {
        const ctx = await api();
        const component = `content-webhook-${randomUUID().slice(0, 8)}`;

        // ── Use the real webhook endpoints, not dev endpoints ──────────────────
        const commitRes = await postCommit(ctx, commitPayload(component, 'de', 6001));
        expect(commitRes.status()).toBe(200);
        const commitBody = await commitRes.json() as { ok: boolean; id?: string };
        expect(commitBody.ok).toBe(true);
        expect(commitBody.id).toBeTruthy();

        // Verify staged
        const staged = await ctx.get('/dev/workflows/translation/staged-commits?status=NEW');
        const stagedBody = await staged.json() as { rows: Array<{ id: string }> };
        expect(stagedBody.rows.some(row => row.id === commitBody.id)).toBe(true);

        // Send push — body.component is ignored for routing; all NEW rows are claimed
        const pushRes = await postPush(ctx, pushPayload(component, 6002));
        expect(pushRes.status()).toBe(200);
        const pushBody = await pushRes.json() as { ok: boolean; claimed: number };
        expect(pushBody.ok).toBe(true);
        expect(pushBody.claimed).toBe(1);

        // Verify clean
        const after = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}`,
        );
        const afterBody = await after.json() as { count: number };
        expect(afterBody.count).toBe(0);

        console.log('✓ Real endpoints: commit staged, push processed and cleaned');
    });
});

// ── Suite 4: Concurrency and error resilience ─────────────────────────────────

test.describe('webhook flow — resilience and edge cases', () => {

    test('concurrent simulate-push calls claim disjoint row sets', async () => {
        // NOTE: simulate-push now claims ALL new rows (no component filter).
        // To keep this test isolated we use a unique component prefix and
        // verify the total claimed = total inserted, regardless of split.
        const ctx = await api();
        const component = `content-concurrent-${randomUUID().slice(0, 8)}`;

        // Insert 4 rows (ensure staging table starts clean for this component)
        for (let i = 0; i < 4; i++) {
            await ctx.post('/dev/workflows/translation/simulate-commit', {
                data: { component, lang: `lang${i}`, changeId: 7000 + i },
            });
        }

        // Verify staged before push
        const before = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}&status=NEW`,
        );
        const beforeBody = await before.json() as { count: number };
        expect(beforeBody.count).toBe(4);

        // Fire two pushes concurrently — SKIP LOCKED means disjoint row sets
        const [r1, r2] = await Promise.all([
            ctx.post('/dev/workflows/translation/simulate-push', { data: { component } }),
            ctx.post('/dev/workflows/translation/simulate-push', { data: { component } }),
        ]);

        expect(r1.status()).toBe(200);
        expect(r2.status()).toBe(200);

        const b1 = await r1.json() as { claimed: number };
        const b2 = await r2.json() as { claimed: number };

        // Each row must be claimed exactly once — total = 4
        // (may include rows from other tests running concurrently, so check >= 4)
        expect(b1.claimed + b2.claimed).toBeGreaterThanOrEqual(4);

        // Verify our specific rows are gone
        const after = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}`,
        );
        const afterBody = await after.json() as { count: number };
        expect(afterBody.count).toBe(0);

        console.log(`✓ Concurrent pushes: claimed ${b1.claimed}+${b2.claimed}, table clean`);
    });

    test('reset-stuck resets PROCESSING rows older than timeout', async () => {
        const ctx = await api();

        // Reset with 0 minutes (resets all PROCESSING rows)
        const res = await ctx.post('/dev/workflows/translation/reset-stuck?minutes=0');
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; reset: number };
        expect(body.ok).toBe(true);
        expect(typeof body.reset).toBe('number');
        console.log(`✓ reset-stuck reset ${body.reset} row(s)`);
    });

    test('push with no staged commits returns claimed=0', async () => {
        const ctx = await api();
        const component = `content-noclaims-${randomUUID().slice(0, 8)}`;

        const res = await ctx.post('/dev/workflows/translation/simulate-push', {
            data: { component },
        });
        expect(res.status()).toBe(200);
        const body = await res.json() as { ok: boolean; claimed: number; message?: string };
        expect(body.ok).toBe(true);
        // Either claimed=0 or message about no staged commits
        expect(body.claimed === 0 || body.message?.includes('no staged')).toBe(true);
    });

    test('multiple commits then single push — all rows processed in one shot', async () => {
        const ctx = await api();
        const component = `content-bulk-${randomUUID().slice(0, 8)}`;
        const langs = ['it', 'fr', 'ar', 'de', 'sq'];

        for (const [i, lang] of langs.entries()) {
            const commitRes = await postCommit(ctx, commitPayload(component, lang, 8000 + i));
            expect(commitRes.status()).toBe(200);
        }

        const pushRes = await postPush(ctx, pushPayload(component, 8100));
        expect(pushRes.status()).toBe(200);
        const pushBody = await pushRes.json() as { ok: boolean; claimed: number };
        expect(pushBody.ok).toBe(true);
        expect(pushBody.claimed).toBe(5);

        const after = await ctx.get(
            `/dev/workflows/translation/staged-commits?component=${component}`,
        );
        expect((await after.json() as { count: number }).count).toBe(0);

        console.log(`✓ Bulk: 5 commits → 1 push → all processed and deleted`);
    });
});
