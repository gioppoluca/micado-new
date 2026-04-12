<script setup lang="ts">
/**
 * src/layouts/MainLayout.vue
 *
 * App shell for the Micado migrants frontend.
 *
 * ── Header ────────────────────────────────────────────────────────────────────
 *   • Left:   Home icon (navigates to / or /home)
 *   • Centre: Dynamic page title (resolved from current route name)
 *   • Right:  Language selector button + Login/Profile icon
 *
 * ── Footer (bottom tab bar) ───────────────────────────────────────────────────
 *   The legacy app had a 5-tab bottom bar.  Visible tabs here:
 *     ···  (More / menu)  | A-Z (Glossary) | Feedback | Chat | Profile/Login
 *
 *   Feature-flagged tabs (Documents, Integration Plan) are added dynamically.
 *
 * ── Language dialog ───────────────────────────────────────────────────────────
 *   A q-dialog lists all active languages.  Selecting one calls
 *   languageStore.select() which triggers reactive re-fetching in all stores
 *   that call startLanguageWatch().
 *
 * ── Language watchers ─────────────────────────────────────────────────────────
 *   Started once here (onMounted) so they live for the full app lifetime.
 */

import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import ConsentPreferencesButton from 'src/components/privacy/ConsentPreferencesButton.vue';
import { useAuthStore } from 'src/stores/auth-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useTopicStore } from 'src/stores/topic-store';
import { useGlossaryStore } from 'src/stores/glossary-store';
import { useContentStore } from 'src/stores/content-store';
import { isEnabled } from 'src/features/feature-flipping';
import { logger } from 'src/services/Logger';
import ApiDebugOverlay from 'src/components/ApiDebugOverlay.vue';
import { LANG_STORAGE_KEY } from 'src/boot/loadData';

// ─── Stores ───────────────────────────────────────────────────────────────────

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const auth = useAuthStore();
const languageStore = useLanguageStore();
const topicStore = useTopicStore();
const glossaryStore = useGlossaryStore();
const contentStore = useContentStore();

// ─── Local state ──────────────────────────────────────────────────────────────

const languageDialog = ref(false);

// ─── Computed ─────────────────────────────────────────────────────────────────

const isAuth = computed(() => auth.authenticated);

/** Short language code shown in the header button (e.g. "IT", "EN"). */
const currentLang = computed(
  () =>
    languageStore.selected?.lang?.toUpperCase() ??
    languageStore.defaultLanguage?.lang?.toUpperCase() ??
    'EN',
);

/**
 * Page title shown in the toolbar.
 * Maps route names to i18n keys; falls back to "Home".
 */
const pageTitle = computed(() => {
  const map: Record<string, string> = {
    welcome: t('menu.home'),
    home: t('menu.home'),
    glossary: t('menu.glossary'),
    about: t('menu.about'),
    privacy: t('privacy.title'),
    profile: t('menu.profile'),
    settings: t('menu.settings'),
  };
  return map[route.name as string] ?? t('menu.home');
});

// ── Bottom navigation tabs ───────────────────────────────────────────────────

interface NavTab {
  name: string;
  icon: string;
  label: string;
  to: string;
  authRequired: boolean;
}

const navTabs = computed<NavTab[]>(() => {
  const tabs: NavTab[] = [
    { name: 'home', icon: 'apps', label: t('menu.home'), to: '/home', authRequired: false },
    { name: 'glossary', icon: 'sort_by_alpha', label: t('menu.glossary'), to: '/glossary', authRequired: false },
    { name: 'feedback', icon: 'thumb_up', label: t('menu.feedback'), to: '/feedback', authRequired: false },
  ];

  // Feature-flagged tabs
  if (isEnabled('FEAT_MIGRANT_LOGIN') && isEnabled('FEAT_DOCUMENTS')) {
    tabs.push({ name: 'documents', icon: 'folder', label: t('menu.documents'), to: '/documents', authRequired: true });
  }

  // Profile / login always last
  tabs.push(
    isAuth.value
      ? { name: 'profile', icon: 'account_circle', label: t('menu.profile'), to: '/profile', authRequired: true }
      : { name: 'login', icon: 'login', label: t('menu.login'), to: '/login', authRequired: false },
  );

  return tabs;
});

// ─── Actions ─────────────────────────────────────────────────────────────────

async function doLogin(): Promise<void> {
  await auth.login(window.location.origin + '/home');
}

async function doLogout(): Promise<void> {
  await auth.logout(window.location.origin + '/');
}

function selectLanguage(langCode: string): void {
  const lang = languageStore.languages.find(l => l.lang === langCode);
  if (!lang) return;
  languageStore.select(lang);
  // Persist the user's choice so it survives page refresh.
  // The loadData boot reads this key back before any component renders.
  try {
    localStorage.setItem(LANG_STORAGE_KEY, langCode);
  } catch {
    logger.warn('[MainLayout] localStorage unavailable — language choice will not persist');
  }
  logger.info('[MainLayout] language selected + persisted', { lang: langCode });
  languageDialog.value = false;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  // Start language-reactive re-fetch watchers once for the app lifetime.
  topicStore.startLanguageWatch();
  glossaryStore.startLanguageWatch();
  contentStore.startLanguageWatch();

  // Ensure languages are loaded (loadData boot may have already done this).
  if (languageStore.languages.length === 0) {
    void languageStore.fetchAll({ active: true }).then(() => {
      if (!languageStore.selected && languageStore.defaultLanguage) {
        languageStore.select(languageStore.defaultLanguage);
      }
    });
  }
});
</script>

<template>
  <q-layout view="hHh lpR fFf" class="micado-layout">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <q-header elevated class="micado-header">
      <q-toolbar>
        <!-- Home button -->
        <q-btn flat dense round icon="home" @click="router.push(isAuth ? '/home' : '/')" aria-label="Home" />

        <!-- Page title -->
        <q-toolbar-title class="micado-toolbar-title text-weight-bold">
          {{ pageTitle }}
        </q-toolbar-title>

        <!-- Language selector -->
        <q-btn flat round dense no-caps :label="currentLang" class="q-mr-xs lang-btn" @click="languageDialog = true"
          aria-label="Select language" />

        <!-- Profile / Login -->
        <q-btn v-if="isAuth" flat round dense icon="account_circle" @click="router.push('/profile')"
          aria-label="Profile" />
        <q-btn v-else flat round dense icon="login" @click="doLogin" aria-label="Login" />
      </q-toolbar>
    </q-header>

    <!-- ── Page container ─────────────────────────────────────────────────── -->
    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- ── Footer tab bar ─────────────────────────────────────────────────── -->
    <q-footer class="micado-footer">
      <q-tabs no-caps align="justify" active-color="orange-7" indicator-color="transparent" class="footer-tabs">
        <q-route-tab v-for="tab in navTabs" :key="tab.name" :to="tab.to" :icon="tab.icon" :label="tab.label"
          :disable="tab.authRequired && !isAuth" />
      </q-tabs>

      <!-- Privacy row -->
      <div class="row items-center justify-center q-gutter-xs privacy-row">
        <q-btn flat no-caps dense size="sm" :label="t('privacy.privacyPageLink')" :to="{ name: 'privacy' }"
          class="text-grey-5" />
        <ConsentPreferencesButton />
      </div>
    </q-footer>

    <!-- ── Language dialog ────────────────────────────────────────────────── -->
    <q-dialog v-model="languageDialog">
      <q-card style="min-width: 300px; max-width: 420px; width: 90vw">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ t('menu.selectLanguage') }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <q-list bordered separator>
            <q-item v-for="language in languageStore.activeLanguages" :key="language.lang" clickable v-ripple
              @click="selectLanguage(language.lang)">
              <q-item-section avatar>
                <q-avatar color="primary" text-color="white" size="36px">
                  {{ language.lang.slice(0, 2).toUpperCase() }}
                </q-avatar>
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ language.name }}</q-item-label>
                <q-item-label caption>{{ language.lang.toUpperCase() }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon v-if="languageStore.selected?.lang === language.lang ||
                  (!languageStore.selected && language.isDefault)" name="check_circle" color="positive" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- ── Logout FAB (when authenticated) ───────────────────────────────── -->
    <q-page-sticky v-if="isAuth" position="top-right" :offset="[18, 74]">
      <q-btn fab-mini color="negative" icon="logout" @click="doLogout" aria-label="Logout" />
    </q-page-sticky>

    <!-- Development API debug overlay — activate with ?debug=1 -->
    <ApiDebugOverlay />
  </q-layout>
</template>

<style lang="scss">
// ── Layout shell ─────────────────────────────────────────────────────────────

.micado-layout {
  font-family: 'Nunito', sans-serif;
}

// Header: Micado primary blue (#0B91CE via $primary)
.micado-header {
  background-color: $primary;
  color: white;
}

.micado-toolbar-title {
  font-size: 18px;
  letter-spacing: 0.2px;
}

.lang-btn {
  font-weight: bold;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  padding: 0 6px;
}

// Footer: white background, orange active tab indicator
.micado-footer {
  background-color: white;
  border-top: 1px solid #e0e0e0;
}

.footer-tabs {
  color: #888;
}

.privacy-row {
  background-color: #f5f5f5;
  padding: 2px 8px;
}
</style>