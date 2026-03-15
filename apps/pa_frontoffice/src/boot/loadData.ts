/**
 * src/boot/loadData.ts
 *
 * Bootstrap boot — runs after i18n and axios, before keycloak.
 *
 * Boot order: envvar → mock → i18n → axios → loadData → keycloak → router-guard
 *
 * WHY this order matters
 * ──────────────────────
 * • envvar has already populated RuntimeConfig, so apiClient has the correct
 *   baseURL before we fire any requests.
 *
 * • i18n must be installed first so this boot can mutate the active locale on
 *   the already-mounted plugin instance (we do NOT reinstall it).
 *
 * • Both endpoints called here are PUBLIC — no Bearer token needed.  We run
 *   before keycloak so locale and tenant values are ready even on anonymous
 *   page loads.
 *
 * • keycloak runs after us so its redirect-back URL processing happens in an
 *   already-localised app.
 *
 * Failure strategy
 * ────────────────
 * If either API call fails the boot catches, logs, and continues:
 *   • language list  → empty  (components handle this gracefully)
 *   • default locale → 'en-US' (the i18n fallback set in boot/i18n.ts)
 *   • tenant values  → empty strings
 *
 * Locale mapping
 * ──────────────
 * The backend stores a short lang tag (e.g. 'en', 'fr', 'ar').
 * The i18n messages bundle uses BCP-47 keys ('en-US', 'fr-FR', …).
 * LANG_TO_LOCALE maps known short tags → message keys; unmapped tags fall
 * back to 'en-US'.
 */

import { defineBoot } from '#q-app/wrappers';
import type { WritableComputedRef } from 'vue';
// Import the i18n instance directly from the boot file that created it.
// With legacy: false, vue-i18n does NOT register $i18n on globalProperties,
// so app.config.globalProperties.$i18n is undefined at runtime.
// The named export from boot/i18n.ts is the correct way to share the instance.
import { i18n } from 'src/boot/i18n';
import { languageApi } from 'src/api/language.api';
import { settingsApi } from 'src/api/settings.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import type { TranslationStateEntry } from 'src/stores/app-store';
import { logger } from 'src/services/Logger';

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
        settingsApi.list(),   // no prefix filter — returns all settings
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
        return;   // continue with store defaults — no white screen
    }

    const settings = settingsResult.value;
    const get = (key: string): string =>
        settings.find(s => s.key === key)?.value ?? '';

    // ── 4. Derive default language ────────────────────────────────────────────

    const defaultLangKey = get('default_language') || 'en';
    const defaultLangObject = langStore.languages.find(l => l.lang === defaultLangKey);
    const defaultLangName = defaultLangObject?.name ?? defaultLangKey;

    langStore.setDefaultByLang(defaultLangKey);

    // ── 5. Switch i18n locale ─────────────────────────────────────────────────
    // i18n.global.locale is a Ref<string> in Composition API mode (legacy: false).
    // Assigning .value switches the active locale for the entire app instantly.

    const localeKey = toLocaleKey(defaultLangKey);
    // Cast needed: WritableComputedRef<Locales> is narrowed to known message keys
    // by vue-i18n, but we switch locale at runtime to keys that may not yet
    // have a bundle (graceful fallback to en-US via vue-i18n fallback config).
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

    appStore.bootstrap({
        defaultLang: defaultLangKey,
        defaultLangName,
        paTenant: get('pa_tenant'),
        migrantTenant: get('migrant_tenant'),
        migrantDomain: get('migrant_domain_name'),
        translationStates,
    });

    logger.info('[boot:loadData] done', { defaultLangKey, localeKey });
});