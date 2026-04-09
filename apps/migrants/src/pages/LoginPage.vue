<template>
  <q-page class="micado-page q-pa-md">
    <q-card flat class="micado-card-panel micado-login-panel q-pa-lg q-mt-xl text-center">
      <div class="text-h5 q-mb-sm">Login</div>
      <div class="text-body2 text-grey-7 q-mb-lg">
        You will be redirected to Keycloak.
      </div>
      <q-btn color="primary" label="Login with Keycloak" unelevated rounded @click="doLogin" />
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { useAuthStore } from 'src/stores/auth-store';

const auth = useAuthStore();

async function doLogin() {
  await auth.login(window.location.origin + '/home');
}
</script>
