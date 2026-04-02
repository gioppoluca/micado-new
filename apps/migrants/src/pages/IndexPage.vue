<template>
  <q-page padding>
    <div class="column q-gutter-md">
      <div>
        <div class="text-h4">Micado Migrants</div>
        <div class="text-subtitle2 text-grey-7">
          Public entry point for the migrant application.
        </div>
      </div>

      <q-banner rounded class="bg-primary text-white">
        The shared bootstrap from the PA application is now wired here too:
        runtime config, public settings, languages, Keycloak and route guard.
      </q-banner>

      <q-card flat bordered>
        <q-card-section>
          <div class="text-subtitle1 q-mb-sm">Bootstrap status</div>
          <div><b>Bootstrapped:</b> {{ appStore.bootstrapped }}</div>
          <div><b>Default language:</b> {{ appStore.defaultLang }}</div>
          <div><b>PA tenant:</b> {{ appStore.paTenant || '(not set)' }}</div>
          <div><b>Migrant tenant:</b> {{ appStore.migrantTenant || '(not set)' }}</div>
          <div><b>Migrant domain:</b> {{ appStore.migrantDomain || '(not set)' }}</div>
          <div><b>Languages loaded:</b> {{ langStore.languages.length }}</div>
          <div><b>Authenticated:</b> {{ auth.authenticated }}</div>
        </q-card-section>
      </q-card>

      <div class="row q-gutter-sm">
        <q-btn v-if="auth.authenticated" color="primary" to="/home" label="Go to home" />
        <q-btn v-else color="primary" to="/login" label="Login" />
        <q-btn v-if="auth.authenticated" outline color="primary" to="/languages" label="Language selection" />
        <q-btn v-if="auth.authenticated" outline color="primary" to="/settings" label="Settings" />
        <q-btn v-if="auth.authenticated" outline color="secondary" to="/profile" label="Profile" />
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useAppStore } from 'src/stores/app-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAuthStore } from 'src/stores/auth-store';

const appStore = useAppStore();
const langStore = useLanguageStore();
const auth = useAuthStore();
</script>
