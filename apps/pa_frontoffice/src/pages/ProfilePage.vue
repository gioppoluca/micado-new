<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Profile</div>
    <div class="q-mb-sm"><b>Authenticated:</b> {{ auth.authenticated }}</div>
    <div class="q-mb-sm"><b>Roles:</b> {{ auth.roles.join(', ') || '(none)' }}</div>

    <q-btn color="negative" label="Logout" @click="logout" />
  </q-page>
</template>

<script setup lang="ts">
import {useAuthStore} from 'src/stores/auth-store';
const auth = useAuthStore();

async function logout() {
  await auth.logout(window.location.origin + '/');
}
</script>
