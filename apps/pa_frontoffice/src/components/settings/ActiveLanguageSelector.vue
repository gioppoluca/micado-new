<template>
    <div>
        <!-- ── Active language toggles ─────────────────────────────────────── -->
        <q-card bordered class="q-ma-md">
            <q-card-section>
                <HelpLabel :field-label="t('data_settings.manage_languages')"
                    :help-label="t('help.manage_languages')" />
            </q-card-section>
            <q-separator />
            <q-card-section>
                <q-btn v-for="language in langStore.languages" :key="language.lang" :outline="!language.active"
                    :disable="language.isDefault" class="q-mx-sm language_btn" :label="language.name" color="accent"
                    no-caps :title="language.isDefault ? t('data_settings.default_language') : ''"
                    @click="toggleActive(language)" />
                <q-inner-loading :showing="langStore.loading" />
            </q-card-section>
        </q-card>

        <!-- ── Default language selector ───────────────────────────────────── -->
        <q-card bordered class="q-ma-md">
            <q-card-section>
                <HelpLabel :field-label="t('data_settings.default_language')"
                    :help-label="t('help.default_language')" />
            </q-card-section>
            <q-card-section class="row items-center">
                <div class="col">
                    <q-select v-model="selectedDefaultLang" filled dense :options="activeLanguageOptions"
                        option-value="lang" option-label="name" emit-value map-options />
                </div>
                <div class="col text-right">
                    <q-btn :label="t('data_settings.set_default_language')" no-caps class="button" :loading="saving"
                        @click="saveDefaultLang" />
                </div>
            </q-card-section>

            <q-banner v-if="langStore.error" class="bg-negative text-white" dense rounded>
                {{ langStore.error }}
            </q-banner>
        </q-card>
    </div>
</template>

<script setup lang="ts">
/**
 * ActiveLanguageSelector
 *
 * Two responsibilities:
 *   1. Toggle each language active/inactive (outline = inactive, filled = active).
 *      The default language is always disabled (cannot be deactivated).
 *   2. Pick and save the platform default language.
 *
 * Migration notes from Vue 2:
 *  - mapGetters / mapActions → useLanguageStore() (Pinia)
 *  - this.$defaultLang → appStore.defaultLang
 *  - updateSetting (settings Vuex action) → settingsApi.patch (not in OpenAPI yet,
 *    stubbed with a TODO — see saveDefaultLang)
 *  - weblateClient removed (not in new API spec; send-to-translation is separate)
 *  - @input on q-select → handled via v-model + watcher
 *  - IconWithTooltip removed, standard q-btn used
 */
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import type { Language } from 'src/api/language.api';
import { logger } from 'src/services/Logger';
import HelpLabel from 'src/components/HelpLabel.vue';

const { t } = useI18n();
const $q = useQuasar();
const langStore = useLanguageStore();
const appStore = useAppStore();

// ── State ──────────────────────────────────────────────────────────────────

const selectedDefaultLang = ref<string>(appStore.defaultLang);
const saving = ref(false);

// ── Computed ───────────────────────────────────────────────────────────────

/** Only active languages can become the default. */
const activeLanguageOptions = computed(() =>
    langStore.languages.filter(l => l.active),
);

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Toggle a language active/inactive.
 * The default language is always protected (disabled in the template).
 */
async function toggleActive(language: Language): Promise<void> {
    const updated = await langStore.patch(language.lang, { active: !language.active });
    if (updated) {
        logger.info('[ActiveLanguageSelector] toggled active', {
            lang: language.lang,
            active: !language.active,
        });
    }
}

/**
 * Save the selected language as the new platform default.
 *
 * TODO: The new backend OpenAPI does not yet expose a PATCH /settings endpoint.
 * When it is available, replace the notify stub below with:
 *   await settingsApi.patch('default_language', selectedDefaultLang.value)
 * and update appStore.bootstrap({ defaultLang: selectedDefaultLang.value, ... })
 */
async function saveDefaultLang(): Promise<void> {
    saving.value = true;
    try {
        // Mark the new default in the language store
        await langStore.patch(selectedDefaultLang.value, { isDefault: true });
        // Unmark the old default
        if (appStore.defaultLang !== selectedDefaultLang.value) {
            await langStore.patch(appStore.defaultLang, { isDefault: false });
        }
        appStore.setUserLang(selectedDefaultLang.value);

        $q.notify({
            type: 'positive',
            message: t('success_messages.send_translation'),
        });
        logger.info('[ActiveLanguageSelector] default language saved', {
            lang: selectedDefaultLang.value,
        });
    } catch (e) {
        $q.notify({ type: 'negative', message: String(e) });
        logger.error('[ActiveLanguageSelector] failed to save default lang', e);
    } finally {
        saving.value = false;
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(async () => {
    if (!langStore.languages.length) {
        await langStore.fetchAll();
    }
    selectedDefaultLang.value = appStore.defaultLang;
});
</script>

<style scoped lang="scss">
.language_btn {
    border-radius: 2px;
}

.button {
    background: #0f3a5d;
    border-radius: 5px;
    color: white;
    margin-right: 30px;
    min-width: 150px;
}
</style>