<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Public settings</div>
    <q-banner class="q-mb-md" rounded>
      This page is intentionally public. Use it to load app configuration before
      login.
    </q-banner>

    <q-btn color="primary" label="Load settings from backend" @click="load" />
    <pre class="q-mt-md">{{ settings }}</pre>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../boot/axios";

type AppSettings = {
  version?: string;
  keycloak?: {
    url?: string;
    realm?: string;
    clientId?: string;
  };
  [k: string]: unknown;
};

const settings = ref<AppSettings | null>(null);

async function load() {
  const res = await api.get<AppSettings>("/settings");
  settings.value = res.data;
}
</script>
