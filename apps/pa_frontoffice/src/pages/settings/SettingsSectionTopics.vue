<template>
    <!--
    SettingsSectionTopics.vue
    ════════════════════════════════════════════════════════════════════════
    Settings card for topic hierarchy configuration.
    Currently manages a single setting: topic.max_depth

    topic.max_depth (integer, 0-based)
      Controls how deep the parent selector goes in TopicTreeSelect.
      0 = only root nodes selectable as parent (depth-0 topics)
      1 = roots + one level of children selectable
      n = nodes at depth < n are selectable; nodes at depth >= n are disabled
      The full tree is always visible — only selectability is limited.

    The setting is stored in app_settings with key 'topic.max_depth'.
    Default value when not set: 99 (= no practical limit).
    -->
    <q-card bordered class="q-ma-md">
        <q-card-section>
            <HelpLabel :field-label="t('data_settings.topic_settings')" :help-label="t('help.topic_settings')" />
        </q-card-section>
        <q-separator />
        <q-card-section class="row items-center">
            <div class="col">
                <div class="text-body2 q-mb-xs">{{ t('data_settings.topic_max_depth') }}</div>
                <div class="text-caption text-grey-6">{{ t('help.topic_max_depth') }}</div>
                <div class="row items-center q-mt-sm">
                    <q-input v-model.number="maxDepth" type="number" dense outlined bg-color="grey-3" class="col-2"
                        :min="0" :readonly="!editing" />
                    <span class="col q-ml-sm text-caption text-grey-7">
                        {{ t('help.topic_max_depth_unit') }}
                    </span>
                </div>
            </div>
            <div class="col-auto text-right q-gutter-sm">
                <q-btn v-if="!editing" class="button_edit" no-caps :label="t('button.edit')" @click="startEdit" />
                <q-btn v-if="editing" class="button_cancel" no-caps :label="t('button.cancel')" @click="cancelEdit" />
                <q-btn v-if="editing" class="button" no-caps :label="t('button.save')" :loading="saving"
                    @click="saveEdit" />
            </div>
        </q-card-section>
    </q-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import HelpLabel from 'src/components/HelpLabel.vue';
import { settingsApi } from 'src/api/settings.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

const SETTING_KEY = 'topic.max_depth';
/** Default when the setting is absent: no practical limit. */
const DEFAULT_MAX_DEPTH = 99;

const { t } = useI18n();
const $q = useQuasar();

const maxDepth = ref<number>(DEFAULT_MAX_DEPTH);
const editing = ref(false);
const saving = ref(false);
let snapshot = DEFAULT_MAX_DEPTH;

onMounted(async () => {
    try {
        const rows = await settingsApi.list('topic.');
        const row = rows.find(r => r.key === SETTING_KEY);
        if (row) {
            const parsed = Number(row.value);
            maxDepth.value = Number.isFinite(parsed) ? parsed : DEFAULT_MAX_DEPTH;
        }
        logger.info('[SettingsSectionTopics] loaded', { maxDepth: maxDepth.value });
    } catch {
        // Setting not yet in DB — keep default
        logger.info('[SettingsSectionTopics] setting not found, using default', { default: DEFAULT_MAX_DEPTH });
    }
});

function startEdit(): void {
    snapshot = maxDepth.value;
    editing.value = true;
}

function cancelEdit(): void {
    maxDepth.value = snapshot;
    editing.value = false;
}

async function saveEdit(): Promise<void> {
    if (maxDepth.value < 0) {
        $q.notify({ type: 'negative', message: t('warning.topic_max_depth_invalid') });
        return;
    }
    saving.value = true;
    try {
        await settingsApi.patch(SETTING_KEY, String(maxDepth.value));
        snapshot = maxDepth.value;
        editing.value = false;
        logger.info('[SettingsSectionTopics] saved', { maxDepth: maxDepth.value });
        $q.notify({ type: 'positive', message: t('notification.settings_saved') });
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