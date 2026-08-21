<template>
    <div>
        <!-- Survey type toggle -->
        <q-card bordered class="q-ma-md">
            <q-card-section>
                <HelpLabel :field-label="t('data_settings.survey_settings')" :help-label="t('help.survey_settings')" />
            </q-card-section>
            <q-separator />
            <q-card-section class="row items-center">
                <div class="col">
                    <span>{{ t('data_settings.ex_survey') }}</span>
                    <q-toggle v-model="fields.internalSurvey" color="green" />
                    <span>{{ t('data_settings.in_survey') }}</span>
                </div>
                <div class="col text-right">
                    <q-btn class="button" no-caps :label="t('button.save')" :loading="saving.internalSurvey"
                        @click="saveSetting('internal_survey')" />
                </div>
            </q-card-section>
        </q-card>

        <!-- Survey URL fields: local, PA, CSO -->
        <SettingTextCard v-for="field in urlFields" :key="field.key" :setting-key="field.key"
            :label-key="field.labelKey" :help-key="field.helpKey" :model-value="String(fields[field.key] ?? '')"
            @update:model-value="fields[field.key] = $event" />
    </div>
</template>

<script setup lang="ts">
/**
 * SettingsSectionSurvey
 *
 * Handles survey-related settings: type toggle + URL fields.
 *
 * The setting keys are application-defined and must all exist in the seed.
 */
import { reactive, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import SettingTextCard from 'src/pages/settings/SettingTextCard.vue';
import HelpLabel from 'src/components/HelpLabel.vue';
import { settingsApi } from '../../api/settings.api';
import { isApiError } from '../../api/client';

const { t } = useI18n();
const $q = useQuasar();
// Initialise from app-store bootstrap values where possible
const fields = reactive<Record<string, string | boolean>>({
    internalSurvey: false,
    survey_local: '',
    survey_pa: '',
    survey_cso: '',
});

const saving = ref<Record<string, boolean>>({});

const urlFields = [
    { key: 'survey_local', labelKey: 'data_settings.survey_local', helpKey: 'help.survey_local' },
    { key: 'survey_pa', labelKey: 'data_settings.survey_pa', helpKey: 'help.survey_pa' },
    { key: 'survey_cso', labelKey: 'data_settings.survey_cso', helpKey: 'help.survey_cso' },
];

onMounted(async () => {
    const keys = ['internal_survey', 'survey_local', 'survey_pa', 'survey_cso'];
    try {
        await Promise.all(
            keys.map(async (key) => {
                const s = await settingsApi.getByKey(key);
                if (key === 'internal_survey') {
                    fields.internalSurvey = s.value === 'true';
                } else {
                    fields[key] = s.value;
                }
            }),
        );
    } catch (e) {
        $q.notify({
            type: 'negative',
            message: isApiError(e) ? e.message : t('error.generic'),
        });
    }
});

async function saveSetting(key: string): Promise<void> {
    saving.value[key] = true;
    try {
        const value = key === 'internal_survey' ? String(fields.internalSurvey) : String(fields[key] ?? '');
        await settingsApi.patch(key, value);
    } catch (e) {
        $q.notify({
            type: 'negative',
            message: isApiError(e) ? e.message : t('error.generic'),
        });
    } finally {
        saving.value[key] = false;
    }
}
</script>

<style scoped>
.button {
    background: #0f3a5d;
    border-radius: 5px;
    color: white;
    min-width: 150px;
}
</style>
