<template>
  <q-page padding>
    <div class="column items-center justify-center" style="min-height: 60vh;">
      <q-icon name="supervisor_account" size="4rem" color="primary" class="q-mb-md" />
      <div class="text-h5 q-mb-sm">Welcome to Micado NGO</div>
      <div class="text-body2 text-grey-7 q-mb-lg">
        NGO / CSO back-office for the Micado platform.
      </div>
      <q-btn
        v-if="!auth.authenticated"
        color="primary"
        icon="login"
        label="Login with Keycloak"
        unelevated
        rounded
        size="lg"
        @click="doLogin"
      />
      <q-btn
        v-else
        color="secondary"
        icon="language"
        label="Select language"
        unelevated
        rounded
        size="lg"
        :to="{ name: 'languages' }"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useAuthStore } from 'src/stores/auth-store';

const auth = useAuthStore();

async function doLogin() {
  await auth.login(window.location.href);
}
</script>
