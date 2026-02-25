<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth-store';

const router = useRouter();
const auth = useAuthStore();

const isAuth = computed(() => auth.authenticated);

async function doLogin() {
  await auth.login(window.location.href); // or router.currentRoute.value.fullPath build
}

async function doLogout() {
  await auth.logout(window.location.origin);
  await router.push('/');
}
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-drawer show-if-above bordered>
      <q-list>

        <q-item clickable v-ripple to="/">
          <q-item-section>Home</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/settings">
          <q-item-section>Settings</q-item-section>
        </q-item>

        <q-separator />

        <!-- Not authenticated -->
        <q-item v-if="!isAuth" clickable v-ripple @click="doLogin">
          <q-item-section>Login</q-item-section>
        </q-item>

        <!-- Authenticated -->
        <q-item v-else clickable v-ripple to="/profile">
          <q-item-section>Profile</q-item-section>
        </q-item>

        <q-item v-if="isAuth" clickable v-ripple @click="doLogout">
          <q-item-section>Logout</q-item-section>
        </q-item>

      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>