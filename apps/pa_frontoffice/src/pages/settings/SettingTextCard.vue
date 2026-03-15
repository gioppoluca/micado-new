<template>
    <q-card bordered class="q-ma-md">
        <q-card-section>
            <HelpLabel :field-label="t(labelKey)" :help-label="t(helpKey)" />
        </q-card-section>
        <q-separator />
        <q-card-section class="row items-center">
            <div class="col">
                <q-input dense bg-color="grey-3" outlined :readonly="!editing" :model-value="modelValue"
                    @update:model-value="$emit('update:modelValue', $event as string)" />
            </div>
            <div class="col text-right q-gutter-sm">
                <q-btn v-if="!editing" class="button_edit" no-caps :label="t('button.edit')" @click="startEdit" />
                <q-btn v-if="editing" class="button_cancel" no-caps :label="t('button.cancel')" @click="cancel" />
                <q-btn v-if="editing" class="button" no-caps :label="t('button.save')" :loading="saving"
                    @click="save" />
            </div>
        </q-card-section>
    </q-card>
</template>

<script setup lang="ts">
/**
 * SettingTextCard — reusable inline-edit card for a single text setting key.
 *
 * Emits update:modelValue on each input change.
 * Save/cancel logic is handled here; parent only needs to bind v-model.
 *
 * NOTE: save() is stubbed pending PATCH /settings endpoint.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import HelpLabel from 'src/components/HelpLabel.vue';
import { settingsApi } from 'src/api/settings.api';
import { isApiError } from 'src/api/client';

const { t } = useI18n();
const $q = useQuasar();

const props = defineProps<{
    settingKey: string
    labelKey: string
    helpKey: string
    modelValue: string
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void
}>()

const editing = ref(false);
const saving = ref(false);
// snapshot to restore on cancel
let snapshot = props.modelValue;

function startEdit(): void {
    snapshot = props.modelValue;
    editing.value = true;
}

function cancel(): void {
    emit('update:modelValue', snapshot);
    editing.value = false;
}

async function save(): Promise<void> {
    saving.value = true;
    try {
        await settingsApi.patch(props.settingKey, props.modelValue);
        snapshot = props.modelValue;
        editing.value = false;
    } catch (e) {
        $q.notify({
            type: 'negative',
            message: isApiError(e) ? e.message : t('error.generic'),
        });
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
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