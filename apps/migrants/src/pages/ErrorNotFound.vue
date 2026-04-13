<script setup lang="ts">
/**
 * src/pages/ErrorNotFound.vue
 * 404 — page not found.
 * Legacy: src/pages/Error404.vue
 */
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>

<template>
  <div class="fixed-center text-center">
    <q-icon name="sentiment_dissatisfied" size="100px" color="grey-4" class="q-mb-md" />
    <p class="text-grey-6">{{ t('error404') }} <strong>(404)</strong></p>
    <q-btn color="accent" style="width: 200px;" to="/" no-caps :label="t('button.back')" />
  </div>
</template>