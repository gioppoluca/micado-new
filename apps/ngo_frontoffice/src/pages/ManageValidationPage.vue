<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <q-icon name="verified" size="2rem" color="primary" class="q-mr-sm" />
      <div>
        <div class="text-h5">{{ t('menu.manage_validation') }}</div>
        <div class="text-body2 text-grey-7">{{ t('menu.manage_validation_desc') }}</div>
      </div>
    </div>

    <q-banner class="bg-blue-1 text-blue-9" rounded>
      <template #avatar>
        <q-icon name="info" color="info" />
      </template>
      {{ t('manage_validation.coming_soon') }}
    </q-banner>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>
