<template>
    <q-card flat bordered class="q-pa-md">
        <q-card-section class="text-body1 text-weight-medium">
            {{ title }}
        </q-card-section>

        <q-card-section class="text-body2 text-grey-8">
            {{ description }}
        </q-card-section>

        <q-card-actions align="right">
            <q-btn color="primary" no-caps :label="t('privacy.enableService')" @click="showPreferences" />
        </q-card-actions>
    </q-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useConsent } from 'src/composables/useConsent';

defineProps<{
    title: string;
    description: string;
}>();

const { t } = useI18n();
const { showPreferences } = useConsent();
</script>