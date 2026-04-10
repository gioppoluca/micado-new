<template>
    <q-btn flat no-caps icon="privacy_tip" :label="t('privacy.managePreferences')" @click="showPreferences" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useConsent } from 'src/composables/useConsent';

const { t } = useI18n();
const { showPreferences } = useConsent();
</script>