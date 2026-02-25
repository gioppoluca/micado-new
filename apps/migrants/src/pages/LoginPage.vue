<template>
  <q-page class="row items-center justify-evenly">
    <div class="column items-center q-gutter-md">
      <div class="text-h5">Login</div>
      <div class="text-body2 text-grey-7">
        You will be redirected to Keycloak.
      </div>
      <q-btn color="primary" label="Login with Keycloak" @click="doLogin" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import {useAuthStore} from 'src/stores/auth-store';

const auth = useAuthStore();

async function doLogin() {
  await auth.login(window.location.origin + '/');
}
</script>
