/**
 * src/stores/app-store.ts
 *
 * Application-level bootstrap state — populated once by the loadData boot file
 * before the first route renders, then read reactively by any component.
 *
 * Replaces the Vue 2 pattern of:
 *   Vue.prototype.$defaultLang = ...
 *   Vue.prototype.$pa_tenant   = ...
 *   Vue.prototype.$translationStateOptions = [...]
 *
 * Nothing in this store is auth-gated: all values come from public settings
 * endpoints that are accessible before Keycloak initialisation.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { logger } from 'src/services/Logger';

// ─── Types ────────────────────────────────────────────────────────────────────

/** One entry in the translationState setting array */
export interface TranslationStateEntry {
    value: string;
    translation: { lang: string; state: string }[];
}

/** Flat option used by <q-select> components */
export interface TranslationStateOption {
    value: string;
    label: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = defineStore('app', () => {
    // ── State ─────────────────────────────────────────────────────────────────

    /** BCP-47 / lang key of the platform default language (e.g. 'en') */
    const defaultLang = ref<string>('en');

    /** Human-readable name of the default language (e.g. 'English') */
    const defaultLangName = ref<string>('English');

    /** Currently active UI language — starts equal to defaultLang */
    const userLang = ref<string>('en');

    /** Keycloak realm / tenant for the PA application */
    const paTenant = ref<string>('');

    /** Keycloak realm / tenant for the Migrant application */
    const migrantTenant = ref<string>('');

    /** Public-facing domain for the Migrant frontend */
    const migrantDomain = ref<string>('');

    /**
     * Full translation-state definitions as received from the backend.
     * Each entry has a `value` (machine key) and a `translation` array
     * with per-language labels.
     */
    const translationStates = ref<TranslationStateEntry[]>([]);

    /** Whether bootstrap has completed at least once */
    const bootstrapped = ref<boolean>(false);

    // ── Getters ───────────────────────────────────────────────────────────────

    /**
     * Flat { value, label } options for the current userLang.
     * Falls back to English, then to the raw value if nothing matches.
     */
    const translationStateOptions = computed<TranslationStateOption[]>(() =>
        translationStates.value.map((entry) => {
            const match =
                entry.translation.find((t) => t.lang === userLang.value) ??
                entry.translation.find((t) => t.lang === 'en') ??
                entry.translation[0];
            return {
                value: entry.value,
                label: match?.state ?? entry.value,
            };
        }),
    );

    // ── Actions ───────────────────────────────────────────────────────────────

    /**
     * Called by the loadData boot with the raw values extracted from the
     * public/settings endpoint.  All fields are optional so a partially-
     * configured backend never prevents the app from starting.
     */
    function bootstrap(payload: {
        defaultLang: string;
        defaultLangName: string;
        paTenant: string;
        migrantTenant: string;
        migrantDomain: string;
        translationStates: TranslationStateEntry[];
    }): void {
        defaultLang.value = payload.defaultLang;
        defaultLangName.value = payload.defaultLangName;
        userLang.value = payload.defaultLang;
        paTenant.value = payload.paTenant;
        migrantTenant.value = payload.migrantTenant;
        migrantDomain.value = payload.migrantDomain;
        translationStates.value = payload.translationStates;
        bootstrapped.value = true;
        logger.info('[app-store] bootstrapped', {
            defaultLang: payload.defaultLang,
            paTenant: payload.paTenant,
            translationStates: payload.translationStates.length,
        });
    }

    /** Switch the active UI language (e.g. when the PA user changes their language preference) */
    function setUserLang(lang: string): void {
        userLang.value = lang;
        logger.info('[app-store] userLang changed', { lang });
    }

    return {
        // state
        defaultLang,
        defaultLangName,
        userLang,
        paTenant,
        migrantTenant,
        migrantDomain,
        translationStates,
        bootstrapped,
        // getters
        translationStateOptions,
        // actions
        bootstrap,
        setUserLang,
    };
});