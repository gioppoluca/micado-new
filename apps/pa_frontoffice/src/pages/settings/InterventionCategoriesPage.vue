<template>
    <q-page padding>
        <div class="text-h5 q-mb-md">{{ t('data_settings.intervention_categories') }}</div>
        <q-banner class="bg-info text-white" rounded>
            <template #avatar><q-icon name="construction" /></template>
            {{ t('data_settings.intervention_categories') }} — migration in progress.
        </q-banner>
    </q-page>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>