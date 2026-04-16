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
 * Default language source of truth
 * ─────────────────────────────────
 * The default language is read exclusively from the languages table
 * (languages.is_default = true), NOT from the settings table.
 * The settings table previously held a 'default_language' key which is now
 * removed to avoid dual sources of truth that can drift out of sync.
 * The PA settings UI (ActiveLanguageSelector) writes isDefault via
 * PATCH /languages/:lang — the languages table is the single source.
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

    const langStore = useLanguageStore();
    const appStore = useAppStore();

    // ── 1. Fetch languages and settings in parallel ───────────────────────────
    // Languages are always needed first: the default language is determined
    // exclusively from languages.is_default, not from the settings table.

    const [, settingsResult] = await Promise.allSettled([
        langStore.fetchAll(),
        settingsApi.list(),
    ]);

    // ── 2. Derive default language from languages table ───────────────────────
    // Single source of truth: languages.is_default = true.
    // Fallback chain: is_default row → first active language → hard 'en'.

    const defaultLangObject =
        langStore.defaultLanguage ??
        langStore.activeLanguages[0] ??
        null;

    const defaultLangKey = defaultLangObject?.lang ?? 'en';
    const defaultLangName = defaultLangObject?.name ?? defaultLangKey;

    logger.info('[boot:loadData] default language resolved', {
        lang: defaultLangKey,
        source: langStore.defaultLanguage ? 'is_default' : langStore.activeLanguages[0] ? 'first_active' : 'hardcoded_fallback',
    });

    // ── 3. Switch i18n locale ─────────────────────────────────────────────────
    // i18n.global.locale is a Ref<string> in Composition API mode (legacy: false).

    const localeKey = toLocaleKey(defaultLangKey);
    (i18n.global.locale as WritableComputedRef<string>).value = localeKey;
    logger.info('[boot:loadData] i18n locale set', { localeKey });

    // ── 4. Process remaining settings (tenant config, translationState) ────────

    let translationStates: TranslationStateEntry[] = [];
    let paTenant = '';
    let migrantTenant = '';
    let migrantDomain = '';

    if (settingsResult.status === 'rejected') {
        logger.error('[boot:loadData] failed to load settings — tenant values will be empty', settingsResult.reason);
    } else {
        const settings = settingsResult.value;
        const get = (key: string): string =>
            settings.find(s => s.key === key)?.value ?? '';

        paTenant = get('pa_tenant');
        migrantTenant = get('migrant_tenant');
        migrantDomain = get('migrant_domain_name');

        const rawTranslationState = get('translationState');
        if (rawTranslationState) {
            try {
                translationStates = JSON.parse(rawTranslationState) as TranslationStateEntry[];
            } catch (e) {
                logger.error('[boot:loadData] failed to parse translationState JSON', e);
            }
        }
    }

    // ── 5. Populate app store ─────────────────────────────────────────────────

    appStore.bootstrap({
        defaultLang: defaultLangKey,
        defaultLangName,
        paTenant,
        migrantTenant,
        migrantDomain,
        translationStates,
    });

    logger.info('[boot:loadData] done', { defaultLangKey, localeKey });
});