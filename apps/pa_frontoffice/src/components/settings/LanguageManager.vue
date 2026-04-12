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
        <q-card v-if="showForm" class="q-pa-xl q-mb-md">
            <q-form @submit.prevent="onSubmit" @reset.prevent="onReset">

                <!-- Name -->
                <HelpLabel :field-label="t('input_labels.language_name')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="nameRef" v-model="shell.name" outlined filled dense counter :maxlength="25"
                    :hint="t('input_labels.required')" :rules="[
                        (v: string) => v.length <= 25 || 'Please use maximum 25 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_name')" />

                <!-- Language tag (primary key — readonly on edit) -->
                <HelpLabel :field-label="t('input_labels.language_abbr')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="abbrRef" v-model="shell.lang" outlined filled dense counter :maxlength="10"
                    :hint="t('input_labels.required')" :readonly="!isNew" :rules="[
                        (v: string) => v.length <= 10 || 'Please use maximum 10 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_abbr')" />

                <!-- ISO code -->
                <HelpLabel :field-label="t('input_labels.language_iso')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input ref="isoRef" v-model="shell.isoCode" outlined filled dense counter :maxlength="25"
                    :hint="t('input_labels.required')" :rules="[
                        (v: string) => v.length <= 25 || 'Please use maximum 25 characters',
                        (v: string) => !!v || 'Field is required',
                    ]" :label="t('input_labels.language_iso')" />

                <!-- Sort order -->
                <HelpLabel :field-label="t('input_labels.language_sort_order')" :help-label="t('help.topic')"
                    style="padding-top: 10px" />
                <q-input v-model.number="shell.sortOrder" outlined filled dense type="number" :min="1" :max="999"
                    :label="t('input_labels.language_sort_order')" />

                <!-- TTS voice identifier -->
                <HelpLabel :field-label="t('input_labels.language_voice_string')"
                    :help-label="t('help.language_voice_string')" style="padding-top: 10px" />
                <q-input v-model="shell.voiceString" outlined filled dense counter :maxlength="100"
                    :label="t('input_labels.language_voice_string')" clearable @clear="shell.voiceString = undefined" />

                <!-- TTS active toggle -->
                <div class="row items-center q-mt-md q-gutter-sm">
                    <HelpLabel :field-label="t('input_labels.language_voice_active')"
                        :help-label="t('help.language_voice_active')" class="col" />
                    <q-toggle v-model="shell.voiceActive" color="accent" :disable="!shell.voiceString?.trim()" />
                </div>
                <div v-if="!shell.voiceString?.trim()" class="text-caption text-grey-6 q-ml-sm q-mb-sm">
                    {{ t('help.language_voice_string') }}
                </div>

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
            <q-item class="text-caption text-grey-7">
                <q-item-section class="col-3">{{ t('input_labels.language_name') }}</q-item-section>
                <q-item-section class="col-2 text-center">{{ t('input_labels.language_abbr') }}</q-item-section>
                <q-item-section class="col-2 text-center">{{ t('input_labels.language_iso') }}</q-item-section>
                <q-item-section class="col-1 text-center">{{ t('input_labels.language_sort_order') }}</q-item-section>
                <q-item-section class="col-2 text-center">{{ t('input_labels.language_voice_string') }}</q-item-section>
                <q-item-section class="col-1 text-center">{{ t('input_labels.language_voice_active') }}</q-item-section>
                <q-item-section class="col-1 text-center">{{ t('input_labels.edit') }}</q-item-section>
            </q-item>
            <q-separator />

            <q-item v-for="language in sortedLanguages" :key="language.lang">
                <q-item-section class="col-3">
                    <div class="row items-center no-wrap">
                        {{ language.name }}
                        <q-badge v-if="language.isDefault" color="accent" outline class="q-ml-sm" label="default" />
                    </div>
                </q-item-section>
                <q-item-section class="col-2 text-center text-mono">{{ language.lang }}</q-item-section>
                <q-item-section class="col-2 text-center text-mono">{{ language.isoCode ?? '—' }}</q-item-section>
                <q-item-section class="col-1 text-center">{{ language.sortOrder }}</q-item-section>
                <q-item-section class="col-2 text-center">
                    <span class="ellipsis" :title="language.voiceString ?? ''">
                        {{ language.voiceString || '—' }}
                    </span>
                </q-item-section>
                <q-item-section class="col-1 text-center">
                    <q-icon :name="language.voiceActive ? 'volume_up' : 'volume_off'"
                        :color="language.voiceActive ? 'positive' : 'grey-5'"
                        :title="language.voiceActive ? 'TTS active' : 'TTS inactive'" />
                </q-item-section>
                <q-item-section class="col-1 text-center">
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
 * Manages all columns of the languages table:
 *   - lang (PK, readonly after creation)
 *   - name, isoCode, sortOrder
 *   - voiceString: TTS engine identifier (e.g. 'Italian Female', 'UK English Female')
 *   - voiceActive: TTS enabled for this language; auto-disabled if voiceString is empty
 *
 * Note: isDefault and active are managed separately by ActiveLanguageSelector.
 *
 * Migration notes from Vue 2:
 *  - storeMappingMixin / Vuex → useLanguageStore() (Pinia)
 *  - Languages prop removed: the store is the single source of truth.
 *  - IconWithTooltip → q-btn icon
 *  - form @submit.prevent / @reset.prevent — Quasar native form validation
 */
import { ref, reactive, computed } from 'vue';
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

// ── Computed ───────────────────────────────────────────────────────────────

/** Languages sorted by sortOrder ascending, then name. */
const sortedLanguages = computed(() =>
    [...langStore.languages].sort((a, b) =>
        a.sortOrder !== b.sortOrder
            ? a.sortOrder - b.sortOrder
            : a.name.localeCompare(b.name),
    ),
);

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
    const nameOk = await nameRef.value?.validate();
    const abbrOk = await abbrRef.value?.validate();
    const isoOk = await isoRef.value?.validate();

    if (!nameOk || !abbrOk || !isoOk) {
        $q.notify({ type: 'negative', message: t('warning.req_fields') });
        return;
    }

    // voiceActive cannot be true without a non-empty voiceString
    const voiceString = shell.voiceString?.trim() || undefined;
    const voiceActive = !!voiceString && shell.voiceActive;

    let success = false;

    if (isNew.value) {
        const created = await langStore.create({
            ...shell,
            voiceString,
            voiceActive,
        });
        success = created !== null;
    } else {
        success = await langStore.patch(shell.lang, {
            name: shell.name,
            // exactOptionalPropertyTypes: omit the key entirely when value is empty
            // rather than passing undefined, which is not assignable to optional string
            ...(shell.isoCode ? { isoCode: shell.isoCode } : {}),
            sortOrder: shell.sortOrder,
            ...(voiceString !== undefined ? { voiceString } : {}),
            voiceActive,
            // active and isDefault are managed by ActiveLanguageSelector — not touched here
        });
    }

    if (success) {
        logger.info('[LanguageManager] saved', { lang: shell.lang, isNew: isNew.value });
        showForm.value = false;
        onReset();
        resetShell();
        $q.notify({ type: 'positive', message: t('success_messages.send_translation') });
    }
}
</script>

<style scoped>
.button {
    background: #0b91ce;
    border-radius: 5px;
    color: white;
}

.text-mono {
    font-family: monospace;
    font-size: 0.85em;
}

.ellipsis {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}
</style>