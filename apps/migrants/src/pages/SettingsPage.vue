<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Public settings</div>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
    </q-banner>

    <q-btn color="primary" label="Load settings from backend" :loading="loading" @click="load" />

    <q-list v-if="settings.length" bordered separator class="q-mt-md rounded-borders">
      <q-item v-for="s in settings" :key="s.key">
        <q-item-section>
          <q-item-label caption>{{ s.key }}</q-item-label>
          <q-item-label>{{ s.value }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../boot/axios';
import { logger } from '../services/Logger';

type Setting = { key: string; value: string };

const settings = ref<Setting[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<Setting[]>('/public/settings');
    settings.value = res.data;
    logger.info('[settings] loaded', res.data);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    logger.error('[settings] failed to load', e);
  } finally {
    loading.value = false;
  }
}
</script>