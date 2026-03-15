<template>
    <q-card bordered class="q-ma-md">
        <q-card-section>
            <HelpLabel :field-label="t('input_labels.lang_editor')" :help-label="t('help.lang_editor')" />
        </q-card-section>

        <q-separator />

        <q-card-section>
            <q-btn class="button" :label="t('button.add_language')" no-caps :disable="showForm" @click="openNew"
                size="15px" />
        </q-card-section>

        <!-- ── Add / Edit form ──────────────────────────────────────────────── -->
        <q-card v-if="showForm" class="q-pa-xl">
            <q-form @submit.prevent="onSubmit" @reset.prevent="onReset">
                <HelpLabel :field-label="t('input_labels.language_name')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="nameRef" v-model="shell.name" outlined filled dense counter :maxlength="25"
                    :hint="t('input_labels.required')" :rules="[
                        (v: string) => v.length <= 25 || 'Please use maximum 25 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_name')" />

                <HelpLabel :field-label="t('input_labels.language_abbr')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="abbrRef" v-model="shell.lang" outlined filled dense counter :maxlength="10"
                    :hint="t('input_labels.required')" :readonly="!isNew" :rules="[
                        (v: string) => v.length <= 10 || 'Please use maximum 10 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_abbr')" />

                <HelpLabel :field-label="t('input_labels.language_iso')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="isoRef" v-model="shell.isoCode" outlined filled dense counter :maxlength="25"
                    :hint="t('input_labels.required')" :rules="[
                        (v: string) => v.length <= 25 || 'Please use maximum 25 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_iso')" />

                <div class="row justify-end q-gutter-sm q-mt-md">
                    <q-btn no-caps flat :label="t('button.cancel')" type="reset" @click="cancelLang" />
                    <q-btn no-caps color="accent" unelevated :label="t('button.save')" :loading="langStore.loading"
                        type="submit" />
                </div>
            </q-form>
        </q-card>

        <!-- ── Language list ────────────────────────────────────────────────── -->
        <q-list>
            <!-- Header row -->
            <q-item>
                <q-item-section class="col-4">{{ t('input_labels.language_name') }}</q-item-section>
                <q-item-section class="col-3 text-center">{{ t('input_labels.language_abbr') }}</q-item-section>
                <q-item-section class="col-3 text-center">{{ t('input_labels.language_iso') }}</q-item-section>
                <q-item-section class="col-2 text-center">{{ t('input_labels.edit') }}</q-item-section>
            </q-item>
            <q-separator />

            <q-item v-for="language in langStore.languages" :key="language.lang">
                <q-item-section class="col-4">{{ language.name }}</q-item-section>
                <q-item-section class="col-3 text-center">{{ language.lang }}</q-item-section>
                <q-item-section class="col-3 text-center">{{ language.isoCode }}</q-item-section>
                <q-item-section class="col-2 text-center">
                    <!--
            Old app used IconWithTooltip with img:statics/icons/Edit.png.
            Replaced with a standard q-btn icon — drop the PNG into
            public/icons/Edit.png and switch to img:icons/Edit.png if needed.
          -->
                    <q-btn flat round dense icon="edit" color="accent" :title="t('help.edit_process')"
                        @click="openEdit(language)" />
                </q-item-section>
            </q-item>
        </q-list>

        <q-banner v-if="langStore.error" class="bg-negative text-white q-ma-md" dense rounded>
            {{ langStore.error }}
        </q-banner>
    </q-card>
</template>

<script setup lang="ts">
/**
 * LanguageManager — add and edit platform languages.
 *
 * Migration notes from Vue 2:
 *  - storeMappingMixin / Vuex → useLanguageStore() (Pinia)
 *  - Languages prop removed: the store is the single source of truth.
 *    Parent no longer needs to pass the list down.
 *  - IconWithTooltip → q-btn icon (see comment in template)
 *  - form @submit.prevent fires onSubmit(); @reset.prevent fires onReset()
 *    which matches Quasar's native form validation pattern
 *  - type="input" on save button corrected to type="submit"
 *  - Ref<QInput> used for programmatic validation instead of this.$refs
 */
import { ref, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import type { QInput } from 'quasar';
import { useLanguageStore } from 'src/stores/language-store';
import type { Language, CreateLanguagePayload } from 'src/api/language.api';
import { logger } from 'src/services/Logger';
import HelpLabel from 'src/components/HelpLabel.vue';

const { t } = useI18n();
const $q = useQuasar();
const langStore = useLanguageStore();

// ── Form state ─────────────────────────────────────────────────────────────

const showForm = ref(false);
const isNew = ref(false);

const emptyShell = (): CreateLanguagePayload => ({
    lang: '',
    isoCode: '',
    name: '',
    active: false,
    isDefault: false,
    sortOrder: 99,
    voiceString: undefined,
    voiceActive: false,
});

const shell = reactive<CreateLanguagePayload>(emptyShell());

// Template refs for validation
const nameRef = ref<QInput | null>(null);
const abbrRef = ref<QInput | null>(null);
const isoRef = ref<QInput | null>(null);

// ── Helpers ────────────────────────────────────────────────────────────────

function resetShell(): void {
    Object.assign(shell, emptyShell());
}

function fillShell(lang: Language): void {
    shell.lang = lang.lang;
    shell.isoCode = lang.isoCode ?? '';
    shell.name = lang.name;
    shell.active = lang.active;
    shell.isDefault = lang.isDefault;
    shell.sortOrder = lang.sortOrder;
    shell.voiceString = lang.voiceString;
    shell.voiceActive = lang.voiceActive;
}

// ── Form actions ───────────────────────────────────────────────────────────

function openNew(): void {
    resetShell();
    isNew.value = true;
    showForm.value = true;
}

function openEdit(language: Language): void {
    fillShell(language);
    isNew.value = false;
    showForm.value = true;
}

function cancelLang(): void {
    showForm.value = false;
    isNew.value = false;
    resetShell();
}

function onReset(): void {
    nameRef.value?.resetValidation();
    abbrRef.value?.resetValidation();
    isoRef.value?.resetValidation();
}

async function onSubmit(): Promise<void> {
    // Trigger validation on all fields
    const nameOk = await nameRef.value?.validate();
    const abbrOk = await abbrRef.value?.validate();
    const isoOk = await isoRef.value?.validate();

    if (!nameOk || !abbrOk || !isoOk) {
        $q.notify({ type: 'negative', message: t('warning.req_fields') });
        return;
    }

    let success = false;
    if (isNew.value) {
        const created = await langStore.create({ ...shell });
        success = created !== null;
    } else {
        success = await langStore.patch(shell.lang, {
            name: shell.name,
            ...(shell.isoCode !== undefined ? { isoCode: shell.isoCode } : {}),
            active: shell.active,
            isDefault: shell.isDefault,
            sortOrder: shell.sortOrder,
            voiceString: shell.voiceString,
            voiceActive: shell.voiceActive,
        });
    }

    if (success) {
        logger.info('[LanguageManager] saved', { lang: shell.lang, isNew: isNew.value });
        showForm.value = false;
        onReset();
        resetShell();
    }
}
</script>

<style scoped>
.button {
    background: #0b91ce;
    border-radius: 5px;
    color: white;
}
</style>