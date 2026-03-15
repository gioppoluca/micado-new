<template>
    <q-page padding>
        <div class="text-h5 q-mb-md">{{ t('data_settings.profile_settings') }}</div>
        <!-- TODO: migrate ProfileSettings component from legacy app -->
        <q-banner class="bg-info text-white" rounded>
            <template #avatar><q-icon name="construction" /></template>
            Profile settings — migration in progress.
        </q-banner>
    </q-page>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>