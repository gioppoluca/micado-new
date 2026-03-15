/**
 * tests/rich-text-editor.spec.ts
 *
 * Suite Playwright per il Rich Text Editor MICADO (PA frontoffice).
 *
 * Prerequisiti:
 *   - Dev server in esecuzione (quasar dev → http://localhost:9000)
 *   - VITE_API_MOCK=true per far girare i test senza backend reale
 *   - Rotta /test/rich-text-editor aggiunta al router (vedi TODO sotto)
 *
 * TODO: aggiungere al router Vue 3 del progetto una rotta di test:
 *   { path: '/test/rich-text-editor', component: () => import('pages/test/RichTextEditorTestPage.vue') }
 * La TestPage deve:
 *   - Montare <RichTextEditor v-model="content" />
 *   - Esporre window.__setContent(md), window.__getMarkdown(), window.__setReadonly(b), window.__setMaxChars(n)
 *
 * Esecuzione:
 *   npx playwright test tests/rich-text-editor.spec.ts
 *   npx playwright test tests/rich-text-editor.spec.ts --headed  # debug visivo
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env['TEST_BASE_URL'] ?? 'http://localhost:9000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoEditor(page: Page): Promise<void> {
    await page.goto(`${BASE_URL}/test/rich-text-editor`);
    await page.waitForSelector('.rich-text-editor', { state: 'visible' });
}

async function gotoViewer(page: Page): Promise<void> {
    await page.goto(`${BASE_URL}/test/rich-text-viewer`);
    await page.waitForSelector('.rtv-wrapper', { state: 'visible' });
}

function proseMirror(page: Page) {
    return page.locator('.editor-content .ProseMirror');
}

async function type(page: Page, text: string): Promise<void> {
    await proseMirror(page).click();
    await page.keyboard.type(text);
}

// ─── Test: Editor base ─────────────────────────────────────────────────────────

test.describe('RichTextEditor — funzionalità base', () => {

    test('Renderizza toolbar e area editor', async ({ page }) => {
        await gotoEditor(page);
        await expect(page.locator('.editor-toolbar')).toBeVisible();
        await expect(proseMirror(page)).toBeVisible();
    });

    test('Digita testo e appare nell\'editor', async ({ page }) => {
        await gotoEditor(page);
        await type(page, 'Ciao MICADO');
        await expect(proseMirror(page)).toContainText('Ciao MICADO');
    });

    test('Ctrl+B applica bold', async ({ page }) => {
        await gotoEditor(page);
        await type(page, 'testo bold');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Control+B');
        await expect(page.locator('.editor-content strong')).toBeVisible();
    });

    test('Ctrl+I applica italic', async ({ page }) => {
        await gotoEditor(page);
        await type(page, 'testo italic');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Control+I');
        await expect(page.locator('.editor-content em')).toBeVisible();
    });

    test('Word count si aggiorna', async ({ page }) => {
        await gotoEditor(page);
        const wc = page.locator('.editor-toolbar .text-caption');
        await expect(wc).toContainText('0');
        await type(page, 'tre parole qui');
        await expect(wc).toContainText('3');
    });

    test('Readonly: toolbar nascosta e contenteditable=false', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setReadonly?.(true));
        await expect(page.locator('.editor-toolbar')).not.toBeVisible();
        await expect(proseMirror(page)).toHaveAttribute('contenteditable', 'false');
    });

    test('Limite caratteri: messaggio di errore visibile', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setMaxChars?.(10));
        await type(page, 'testo sicuramente troppo lungo');
        await expect(page.locator('.text-negative')).toBeVisible();
    });
});

// ─── Test: Markdown I/O ────────────────────────────────────────────────────────

test.describe('RichTextEditor — Markdown', () => {

    test('Carica Markdown e renderizza bold', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setContent?.('**Testo bold**'));
        await expect(page.locator('.editor-content strong')).toContainText('Testo bold');
    });

    test('Serializza il contenuto in Markdown', async ({ page }) => {
        await gotoEditor(page);
        await type(page, 'parola');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Control+B');
        const md = await page.evaluate(() => window.__getMarkdown?.() ?? '');
        expect(md).toContain('**parola**');
    });

    test('Link salvato come Markdown corretto', async ({ page }) => {
        await gotoEditor(page);
        await type(page, 'click here');
        await page.keyboard.press('Control+A');
        // Apri link dialog tramite toolbar
        await page.locator('.editor-toolbar [aria-label="link"]').click();
        await page.locator('.q-dialog .q-input input').fill('https://example.com');
        await page.locator('.q-dialog .q-btn').filter({ hasText: 'Applica' }).click();
        const md = await page.evaluate(() => window.__getMarkdown?.() ?? '');
        expect(md).toContain('[click here](https://example.com)');
    });
});

// ─── Test: Mention entità MICADO ──────────────────────────────────────────────

test.describe('RichTextEditor/Viewer — Mention MICADO', () => {

    test('Span mention renderizzato con classe micado-mention', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setContent?.('@[g,1](asylum seeker)'));
        await expect(page.locator('.micado-mention')).toBeVisible();
        await expect(page.locator('.micado-mention')).toContainText('asylum seeker');
    });

    test('Attributi data-entity-type e data-entity-id corretti', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setContent?.('@[i,10](health rights)'));
        const span = page.locator('.micado-mention');
        await expect(span).toHaveAttribute('data-entity-type', 'i');
        await expect(span).toHaveAttribute('data-entity-id', '10');
    });

    test('In edit mode il click sul mention NON apre il dialog', async ({ page }) => {
        await gotoEditor(page);
        await page.evaluate(() => window.__setContent?.('@[g,1](asylum seeker)'));
        await page.locator('.micado-mention').click();
        await expect(page.locator('.entity-preview-dialog')).not.toBeVisible();
    });

    test('In viewer mode il click sul mention apre EntityPreviewDialog', async ({ page }) => {
        await gotoViewer(page);
        await page.evaluate(() => window.__setViewerContent?.('@[g,1](asylum seeker)'));
        await page.locator('.micado-mention').first().click();
        await expect(page.locator('.entity-preview-dialog')).toBeVisible();
    });

    test('Il dialog mostra il titolo dell\'entità (da mock store)', async ({ page }) => {
        await gotoViewer(page);
        await page.evaluate(() => window.__setViewerContent?.('@[g,1](asylum seeker)'));
        await page.locator('.micado-mention').first().click();
        // MOCK_GLOSSARY[0].title = 'asylum seeker'
        await expect(page.locator('.entity-preview-dialog .q-toolbar-title')).toContainText('asylum seeker');
    });
});

// ─── Test: autoLinkEntities ────────────────────────────────────────────────────

test.describe('autoLinkEntities — auto-linking', () => {
    // Questi test usano /test/auto-link che espone window.autoLinkEntities globalmente.
    // TODO: creare src/pages/test/AutoLinkTestPage.vue

    test('Linka titolo di entità nel testo', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/auto-link`);
        const result = await page.evaluate((): string => {
            const entities = { g: [{ id: 1, title: 'asylum seeker', published: true, translations: [] }], i: [], p: [], e: [] };
            return (window as Record<string, unknown>).autoLinkEntities?.('un asylum seeker nel testo', entities, 'en') as string ?? '';
        });
        expect(result).toContain('@[g,1](asylum seeker)');
    });

    test('Non duplica mention già esistente', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/auto-link`);
        const result = await page.evaluate((): string => {
            const entities = { g: [{ id: 1, title: 'asylum seeker', published: true, translations: [] }], i: [], p: [], e: [] };
            return (window as Record<string, unknown>).autoLinkEntities?.('@[g,1](asylum seeker)', entities, 'en') as string ?? '';
        });
        // Non deve wrappare di nuovo
        expect(result.match(/@\[g,1\]/g)?.length ?? 0).toBe(1);
    });

    test('Rispetta priorità g > p > i > e per titoli duplicati', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/auto-link`);
        const result = await page.evaluate((): string => {
            const entities = {
                g: [{ id: 1, title: 'SAME', published: true, translations: [] }],
                i: [{ id: 2, title: 'SAME', published: true, translations: [] }],
                p: [],
                e: [],
            };
            return (window as Record<string, unknown>).autoLinkEntities?.('SAME nel testo', entities, 'en') as string ?? '';
        });
        expect(result).toContain('@[g,1]');
        expect(result).not.toContain('@[i,2]');
    });

    test('Non inserisce mention dentro link Markdown', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/auto-link`);
        const result = await page.evaluate((): string => {
            const entities = { g: [{ id: 1, title: 'asylum seeker', published: true, translations: [] }], i: [], p: [], e: [] };
            return (window as Record<string, unknown>).autoLinkEntities?.('[asylum seeker](https://example.com)', entities, 'en') as string ?? '';
        });
        expect(result).not.toContain('@[g,1]');
        expect(result).toContain('[asylum seeker](https://example.com)');
    });
});

// ─── Test: MultiLangEditorTabs ─────────────────────────────────────────────────

test.describe('MultiLangEditorTabs — multilingua', () => {

    test('Mostra una tab per ogni lingua', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/multilang-editor`);
        // Il mock languages.api restituisce 4 lingue attive
        const tabs = page.locator('.mlet-wrapper .q-tab');
        await expect(tabs).toHaveCount(4);
    });

    test('Cambiare lingua non mescola il contenuto', async ({ page }) => {
        await page.goto(`${BASE_URL}/test/multilang-editor`);
        // Scrivi in EN
        await page.locator('.q-tab[name="en"]').click();
        await proseMirror(page).click();
        await page.keyboard.type('English content');
        // Passa a IT
        await page.locator('.q-tab[name="it"]').click();
        await expect(proseMirror(page)).not.toContainText('English content');
    });
});