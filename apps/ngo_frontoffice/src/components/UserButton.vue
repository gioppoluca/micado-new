<script setup lang="ts">
/**
 * UserButton — migrated from Vue 2 Options API to Vue 3 Composition API.
 *
 * Original used:
 *  - storeMappingMixin (Vuex mapGetters/mapActions) → replaced with Pinia useAuthStore
 *  - this.$auth.loggedIn() → auth.authenticated
 *  - this.$store.state.auth.user → auth.keycloak.tokenParsed
 *  - getUserPic Vuex action → kept as a local stub (user/pic store not yet migrated)
 *  - this.$router.push → useRouter()
 *
 * NOTE: The `user/pic` Vuex store is not yet migrated. Profile picture loading
 * is stubbed out — the avatar falls back to the material `account_circle` icon
 * until the user store is ported to Pinia.
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth-store';

const router = useRouter();
const auth = useAuthStore();

const picUrl = ref<string | null>(null);

const isLoggedIn = computed(() => auth.authenticated);

onMounted(() => {
  // TODO: replace with Pinia user store once migrated
  // const userSub = auth.keycloak?.tokenParsed?.['sub']
  // if (isLoggedIn.value && userSub) {
  //   picUrl.value = await userStore.getUserPic(userSub)
  // }
});

function toProfile() {
  void router.push({ name: 'profile' });
}
</script>

<template>
  <q-avatar
    clickable
    size="42px"
    data-cy="userButton"
    @click="toProfile"
  >
    <img
      v-if="isLoggedIn && picUrl"
      :src="picUrl"
      alt="Profile"
    >
    <q-icon
      v-else
      size="42px"
      name="account_circle"
    />
  </q-avatar>
</template>
