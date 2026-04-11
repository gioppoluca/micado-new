<script setup lang="ts">
/**
 * src/pages/ProfilePage.vue
 *
 * Authenticated user hub — navigation menu to personal features.
 *
 * ── Items ─────────────────────────────────────────────────────────────────────
 *   • My Documents      — FEAT_DOCUMENTS (feature-flagged)
 *   • Integration Plans — FEAT_TASKS     (feature-flagged)
 *   • Settings          — always visible when authenticated
 *   • Logout            — Keycloak session end
 *
 * ── Note on user data ─────────────────────────────────────────────────────────
 *   The legacy page loaded detailed user profile (photo, personal data) from a
 *   separate /user endpoint that does not yet have a public migrant equivalent.
 *   This page covers the navigation shell; user-data editing is deferred.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/PersonalProfile.vue (Vue 2 / Vuex)
 *   New:    src/pages/ProfilePage.vue     (Vue 3 / Pinia)
 */

import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from 'src/stores/auth-store';
import { isEnabled } from 'src/features/feature-flipping';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();

// ── Feature flags ─────────────────────────────────────────────────────────────

const hasDocs = computed(() => isEnabled('FEAT_MIGRANT_LOGIN') && isEnabled('FEAT_DOCUMENTS'));
const hasTasks = computed(() => isEnabled('FEAT_MIGRANT_LOGIN') && isEnabled('FEAT_TASKS'));

// ── User display name from Keycloak token ─────────────────────────────────────
// keycloak.tokenParsed carries the parsed JWT; name/preferred_username are standard claims.

const displayName = computed<string>(() => {
  const kc = auth.keycloak;
  if (!kc?.tokenParsed) return '';
  const p = kc.tokenParsed as Record<string, string>;
  return p['name'] ?? p['preferred_username'] ?? p['email'] ?? '';
});

const displayEmail = computed<string>(() => {
  const p = auth.keycloak?.tokenParsed as Record<string, string> | undefined;
  return p?.['email'] ?? '';
});

// ── Navigation ────────────────────────────────────────────────────────────────

function goDocuments(): void {
  logger.info('[ProfilePage] navigate to documents');
  void router.push({ name: 'documents' });
}

function goTasks(): void {
  logger.info('[ProfilePage] navigate to tasks');
  void router.push({ name: 'tasks' });
}

function goSettings(): void {
  void router.push({ name: 'settings' });
}

async function doLogout(): Promise<void> {
  logger.info('[ProfilePage] logout');
  await auth.logout(window.location.origin + '/');
}
</script>

<template>
  <q-page class="profile-page">

    <!-- User avatar + name -->
    <div class="row justify-center q-pt-lg q-pb-md">
      <div class="column items-center">
        <q-avatar size="72px" color="primary" text-color="white" class="q-mb-sm">
          <q-icon name="account_circle" size="64px" />
        </q-avatar>
        <div v-if="displayName" class="text-weight-bold text-primary profile-name">
          {{ displayName }}
        </div>
        <div v-if="displayEmail" class="text-caption text-grey-6">
          {{ displayEmail }}
        </div>
      </div>
    </div>

    <div class="profile-divider" />

    <!-- My Documents (feature-flagged) -->
    <template v-if="hasDocs">
      <q-item clickable v-ripple class="profile-item" @click="goDocuments">
        <q-item-section avatar>
          <q-icon name="folder" color="primary" size="30px" />
        </q-item-section>
        <q-item-section>
          <q-item-label class="profile-label">{{ t('menu.documents') }}</q-item-label>
        </q-item-section>
      </q-item>
      <div class="profile-divider" />
    </template>

    <!-- Integration Plans / Tasks (feature-flagged) -->
    <template v-if="hasTasks">
      <q-item clickable v-ripple class="profile-item" @click="goTasks">
        <q-item-section avatar>
          <q-icon name="assignment" color="primary" size="30px" />
        </q-item-section>
        <q-item-section>
          <q-item-label class="profile-label">{{ t('menu.tasks') }}</q-item-label>
        </q-item-section>
      </q-item>
      <div class="profile-divider" />
    </template>

    <!-- Settings -->
    <q-item clickable v-ripple class="profile-item" @click="goSettings">
      <q-item-section avatar>
        <q-icon name="settings" color="primary" size="30px" />
      </q-item-section>
      <q-item-section>
        <q-item-label class="profile-label">{{ t('menu.settings') }}</q-item-label>
      </q-item-section>
    </q-item>
    <div class="profile-divider" />

    <!-- Logout -->
    <div class="row justify-center q-pt-lg q-pb-xl">
      <q-btn outline rounded no-caps icon="logout" :label="t('desc_labels.logout')" class="logout-btn"
        @click="doLogout" />
    </div>

  </q-page>
</template>

<style scoped lang="scss">
.profile-page {
  max-width: 480px;
  margin: 0 auto;
}

.profile-name {
  font-size: 18px;
  color: #0f3a5d;
}

.profile-divider {
  background-color: #efefef;
  height: 5px;
}

.profile-item {
  padding: 12px 16px;
}

.profile-label {
  font-family: 'Nunito', sans-serif;
  font-weight: bold;
  font-size: 18px;
  line-height: 25px;
  color: #0f3a5d;
}

.logout-btn {
  border-color: #9e1f63;
  color: #9e1f63;
  font-weight: 700;
  min-width: 250px;
  border-radius: 50px;
}
</style>