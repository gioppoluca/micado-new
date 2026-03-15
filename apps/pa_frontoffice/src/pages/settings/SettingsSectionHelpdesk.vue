<template>
    <div>
        <SettingTextCard v-for="field in fields" :key="field.key" :setting-key="field.key" :label-key="field.labelKey"
            :help-key="field.helpKey" :model-value="values[field.key] ?? ''" @update:model-value="values[field.key] = $event" />
        <!-- Duration of new (numeric) -->
        <q-card bordered class="q-ma-md">
            <q-card-section>
                <HelpLabel :field-label="t('data_settings.duration_of_new')" :help-label="t('help.duration_of_new')" />
            </q-card-section>
            <q-separator />
            <q-card-section class="row items-center">
                <div class="col">
                    <div class="row items-center">
                        <q-input v-model.number="durationOfNew" type="number" dense class="col-2" bg-color="grey-3"
                            outlined :readonly="!editingDuration" />
                        <p class="col q-ml-sm duration">{{ t('input_labels.days') }}</p>
                    </div>
                </div>
                <div class="col text-right q-gutter-sm">
                    <q-btn v-if="!editingDuration" class="button_edit" no-caps :label="t('button.edit')"
                        @click="startDuration" />
                    <q-btn v-if="editingDuration" class="button_cancel" no-caps :label="t('button.cancel')"
                        @click="cancelDuration" />
                    <q-btn v-if="editingDuration" class="button" no-caps :label="t('button.save')"
                        :loading="savingDuration" @click="saveDuration" />
                </div>
            </q-card-section>
        </q-card>
    </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import SettingTextCard from 'src/pages/settings/SettingTextCard.vue';
import HelpLabel from 'src/components/HelpLabel.vue';
import { settingsApi } from '../../api/settings.api';
import { isApiError } from '../../api/client';

const { t } = useI18n();
const $q = useQuasar();

const fields = [
    { key: 'helpdesk_pa', labelKey: 'data_settings.helpdesk_pa', helpKey: 'help.helpdesk_pa' },
    { key: 'helpdesk_ngo', labelKey: 'data_settings.helpdesk_ngo', helpKey: 'help.helpdesk_ngo' },
    { key: 'helpdesk_migrant', labelKey: 'data_settings.helpdesk_migrant', helpKey: 'help.helpdesk_migrant' },
    { key: 'feedback_email', labelKey: 'data_settings.pa_email', helpKey: 'help.pa_email_setting' },
];

const values = reactive<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, ''])),
);

const durationOfNew = ref<number>(0);
const editingDuration = ref(false);
const savingDuration = ref(false);
let durationSnapshot = 0;

onMounted(async () => {
    const keys = ['helpdesk_pa', 'helpdesk_ngo', 'helpdesk_migrant', 'feedback_email', 'duration_of_new'];
    await Promise.allSettled(
        keys.map(async (key) => {
            try {
                const s = await settingsApi.getByKey(key);
                if (key === 'duration_of_new') {
                    durationOfNew.value = Number(s.value) || 0;
                } else {
                    values[key] = s.value;
                }
            } catch {
                // setting not yet in DB — keep default empty value
            }
        }),
    );
});

function startDuration(): void { durationSnapshot = durationOfNew.value; editingDuration.value = true; }
function cancelDuration(): void { durationOfNew.value = durationSnapshot; editingDuration.value = false; }
async function saveDuration(): Promise<void> {
    savingDuration.value = true;
    try {
        await settingsApi.patch('duration_of_new', String(durationOfNew.value));
        editingDuration.value = false;
    } catch (e) {
        $q.notify({
            type: 'negative',
            message: isApiError(e) ? e.message : t('error.generic'),
        });
    } finally {
        savingDuration.value = false;
    }
}
</script>

<style scoped>
.duration {
    padding-left: 10px;
    font-size: 20px;
}

.button {
    background: #0f3a5d;
    border-radius: 5px;
    color: white;
    min-width: 150px;
    margin-right: 8px;
}

.button_edit {
    background: #ff7c44;
    border-radius: 5px;
    color: white;
    min-width: 150px;
    margin-right: 8px;
}

.button_cancel {
    border: 1px solid #c71f40;
    border-radius: 5px;
    min-width: 150px;
    margin-right: 8px;
}
</style>