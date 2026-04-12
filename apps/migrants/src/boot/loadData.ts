/**
 * src/boot/loadData.ts
 *
 * Bootstrap boot — runs after i18n and axios, before keycloak.
 *
 * Boot order: envvar → mock → i18n → axios → loadData → keycloak → router-guard
 *
 * ── Language selection priority ───────────────────────────────────────────────
 *
 *   1. localStorage key "micado:lang" — persisted user choice (wins on refresh)
 *   2. Backend setting default_language — server-configured default
 *   3. 'en' — hardcoded fallback
 *
 *   When the user explicitly picks a language (MainLayout.selectLanguage),
 *   the key is written to localStorage.  On next page load this boot reads it
 *   back and restores the choice before any component renders.
 *
 * ── Failure strategy ──────────────────────────────────────────────────────────
 *   If either API call fails the boot catches, logs, and continues:
 *     • language list  → empty  (components handle this gracefully)
 *     • default locale → 'en-US' (the i18n fallback set in boot/i18n.ts)
 *     • tenant values  → empty strings
 */

import { defineBoot } from '#q-app/wrappers';
import type { WritableComputedRef } from 'vue';
import { i18n } from 'src/boot/i18n';
import { languageApi } from 'src/api/language.api';
import { settingsApi } from 'src/api/settings.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import type { TranslationStateEntry } from 'src/stores/app-store';
import { logger } from 'src/services/Logger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** localStorage key used to persist the user's language choice across sessions. */
export const LANG_STORAGE_KEY = 'micado:lang';

// ─── Locale mapping ───────────────────────────────────────────────────────────

const LANG_TO_LOCALE: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    es: 'es-ES',
    ar: 'ar-SA',
    uk: 'uk-UA',
    ti: 'ti-ET',
    fa: 'fa-IR',
    so: 'so-SO',
    tr: 'tr-TR',
};

function toLocaleKey(lang: string): string {
    return LANG_TO_LOCALE[lang] ?? 'en-US';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export default defineBoot(async () => {
    logger.info('[boot:loadData] starting');

    // ── 1. Fetch languages and settings in parallel ───────────────────────────

    const [languagesResult, settingsResult] = await Promise.allSettled([
        languageApi.list(),
        settingsApi.list(),
    ]);

    // ── 2. Populate language store ────────────────────────────────────────────

    const langStore = useLanguageStore();

    if (languagesResult.status === 'fulfilled') {
        await langStore.fetchAll();
        logger.info('[boot:loadData] languages loaded', { count: languagesResult.value.length });
    } else {
        logger.error('[boot:loadData] failed to load languages', languagesResult.reason);
    }

    // ── 3. Process settings ───────────────────────────────────────────────────

    const appStore = useAppStore();

    if (settingsResult.status === 'rejected') {
        logger.error('[boot:loadData] failed to load settings', settingsResult.reason);
        // Continue with defaults — no white screen.
    }

    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : [];
    const get = (key: string): string =>
        settings.find(s => s.key === key)?.value ?? '';

    // ── 4. Derive effective language ──────────────────────────────────────────
    //
    //   Priority:
    //     a) user's persisted choice from localStorage  ← wins on page refresh
    //     b) server-configured default_language setting
    //     c) hardcoded fallback 'en'
    //
    //   We also validate that the persisted lang actually exists in the active
    //   language list (in case an admin removed it after the user's last visit).

    const serverDefaultLang = get('default_language') || 'en';

    const storedLang = (() => {
        try {
            return localStorage.getItem(LANG_STORAGE_KEY);
        } catch {
            // localStorage blocked by browser privacy settings — ignore
            return null;
        }
    })();

    const availableLangs = langStore.languages.map(l => l.lang);

    // Validate the stored lang is still active; fall back to server default if not.
    const effectiveLang = (storedLang && availableLangs.includes(storedLang))
        ? storedLang
        : serverDefaultLang;

    logger.info('[boot:loadData] language resolution', {
        storedLang,
        serverDefaultLang,
        effectiveLang,
        available: availableLangs,
    });

    langStore.setDefaultByLang(effectiveLang);

    // ── 5. Switch i18n locale ─────────────────────────────────────────────────

    const localeKey = toLocaleKey(effectiveLang);
    (i18n.global.locale as WritableComputedRef<string>).value = localeKey;
    logger.info('[boot:loadData] i18n locale set', { localeKey });

    // ── 6. Parse translationState ─────────────────────────────────────────────

    let translationStates: TranslationStateEntry[] = [];
    const rawTranslationState = get('translationState');
    if (rawTranslationState) {
        try {
            translationStates = JSON.parse(rawTranslationState) as TranslationStateEntry[];
        } catch (e) {
            logger.error('[boot:loadData] failed to parse translationState JSON', e);
        }
    }

    // ── 7. Populate app store ─────────────────────────────────────────────────

    const defaultLangObject = langStore.languages.find(l => l.lang === serverDefaultLang);
    const defaultLangName = defaultLangObject?.name ?? serverDefaultLang;

    appStore.bootstrap({
        defaultLang: serverDefaultLang,   // canonical server default — never overridden
        defaultLangName,
        paTenant: get('pa_tenant'),
        migrantTenant: get('migrant_tenant'),
        migrantDomain: get('migrant_domain_name'),
        translationStates,
    });

    logger.info('[boot:loadData] done', { serverDefaultLang, effectiveLang, localeKey });
});