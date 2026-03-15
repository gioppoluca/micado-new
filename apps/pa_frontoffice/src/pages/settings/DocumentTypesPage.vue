<template>
    <q-page padding>
        <div class="text-h5 q-mb-md">{{ t('data_settings.document_types') }}</div>
        <q-banner class="bg-info text-white" rounded>
            <template #avatar><q-icon name="construction" /></template>
            {{ t('data_settings.document_types') }} — migration in progress.
        </q-banner>
    </q-page>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>