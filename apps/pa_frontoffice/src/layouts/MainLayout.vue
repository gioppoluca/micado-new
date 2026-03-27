<script setup lang="ts">
/**
 * MainLayout — Vue 3 / Quasar 2 sidebar layout.
 *
 * Role format: raw Keycloak token values (no "Application/" prefix).
 * exact: true  → active-class only matches when path is exactly `to`
 * exact: false → active-class matches when path starts with `to` (for nested routes)
 */
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth-store';
import UserButton from '../components/UserButton.vue';

const { t } = useI18n();
const auth = useAuthStore();

const leftDrawerOpen = ref(false);
const selectedKey = ref('menu.home');

const isLoggedIn = computed(() => auth.authenticated);

function toLogin() { void auth.login(window.location.href); }
function toLogout() { void auth.logout(window.location.origin); }

interface NavItem {
  label: string;
  icon: string;
  active_icon: string;
  to: string;
  description: string;
  /** When false, active-class matches on any child path (nested routes). Default true. */
  exact?: boolean;
  auth?: string | string[];
}

const navs: NavItem[] = [
  {
    label: 'menu.home',
    icon: 'home', active_icon: 'home',
    to: '/',
    exact: true,
    description: 'menu.home_desc',
  },
  {
    label: 'menu.situation',
    icon: 'public', active_icon: 'public',
    to: '/situation/main',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.situation_desc',
  },
  {
    label: 'menu.migrant',
    icon: 'people', active_icon: 'people',
    to: '/migrant',
    auth: 'pa_admin',
    description: 'menu.migrant_desc',
  },
  {
    label: 'menu.cso',
    icon: 'supervisor_account', active_icon: 'supervisor_account',
    to: '/cso',
    auth: 'pa_admin',
    description: 'menu.cso_desc',
  },
  {
    label: 'menu.process',
    icon: 'timeline', active_icon: 'timeline',
    to: '/guided_process_editor',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.process_desc',
  },
  {
    label: 'menu.information_centre',
    icon: 'info', active_icon: 'info',
    to: '/information',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.information_centre_desc',
  },
  {
    label: 'menu.events',
    icon: 'event', active_icon: 'event',
    to: '/events',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.events_desc',
  },
  {
    label: 'menu.usage',
    icon: 'bar_chart', active_icon: 'bar_chart',
    to: '/dashboard',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.usage_desc',
  },
  {
    label: 'menu.glossary',
    icon: 'menu_book', active_icon: 'menu_book',
    to: '/glossary',
    auth: ['micado_superadmin', 'pa_admin'],
    description: 'menu.glossary_desc',
  },
  {
    label: 'menu.setting',
    icon: 'settings', active_icon: 'settings',
    // Nested route — exact:false so active-class applies for all /data_settings/* children
    to: '/data_settings/profile_settings',  // resolves to named route 'settings-profile'
    auth: ['micado_superadmin', 'pa_admin'],
    exact: false,
    description: 'menu.setting_desc',
  },
];

function checkAuth(navAuth?: string | string[]): boolean {
  if (!navAuth) return true;
  const required = Array.isArray(navAuth) ? navAuth : [navAuth];
  return required.some((role) => auth.hasRole(role));
}

function changeIcon(label: string) {
  selectedKey.value = label;
}
</script>

<template>
  <q-layout view="hHh LpR fFf">

    <q-drawer :mini="leftDrawerOpen" show-if-above :breakpoint="767" bordered class="bg-accent text-white">
      <!-- Hamburger + title -->
      <q-item class="shadow-box shadow-10">
        <q-item-section avatar>
          <q-icon name="menu" class="cursor-pointer" @click="leftDrawerOpen = !leftDrawerOpen" />
        </q-item-section>
        <q-item-section>
          <q-item-label class="app_label">{{ t('application_title') }}</q-item-label>
        </q-item-section>
      </q-item>

      <!-- User avatar -->
      <div class="column flex-center q-gutter-y-md" style="padding-top:10px">
        <UserButton />
      </div>

      <hr class="separator">

      <!-- Login -->
      <q-item v-if="!isLoggedIn" clickable @click="toLogin">
        <q-item-section avatar><q-icon name="exit_to_app" /></q-item-section>
        <q-item-section><q-item-label>{{ t('menu.login') }}</q-item-label></q-item-section>
      </q-item>

      <!-- Logout -->
      <q-item v-if="isLoggedIn" clickable @click="toLogout">
        <q-item-section avatar><q-icon name="power_settings_new" /></q-item-section>
        <q-item-section><q-item-label>{{ t('menu.logout') }}</q-item-label></q-item-section>
      </q-item>

      <hr class="separator">

      <!-- Nav items — authenticated -->
      <q-list dark v-if="isLoggedIn">
        <q-item-label header>{{ t('menu.title') }}</q-item-label>

        <q-item v-for="nav in navs" :key="nav.label" :disable="!checkAuth(nav.auth)" :exact="nav.exact !== false" dark
          clickable active-class="my-menu-link" :to="nav.to" style="padding-top:16px; padding-bottom:16px"
          @click="changeIcon(nav.label)">
          <q-item-section avatar>
            <q-icon :name="selectedKey === nav.label ? nav.active_icon : nav.icon" />
          </q-item-section>
          <q-item-section>
            <q-item-label style="font-weight:500">{{ t(nav.label) }}</q-item-label>
            <q-item-label caption>{{ t(nav.description) }}</q-item-label>
          </q-item-section>
        </q-item>

        <br>
        <div class="row justify-center full-width text-center q-pa-md">
          <div class="text-caption text-grey-5">Powered by Micado</div>
        </div>
      </q-list>

      <!-- Nav items — not authenticated -->
      <q-list dark v-else>
        <div class="row justify-center full-width text-center q-pa-md">
          <div class="text-caption text-grey-5">Powered by Micado</div>
        </div>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

  </q-layout>
</template>

<style scoped>
@media screen and (min-width: 768px) {
  .my-menu-link {
    color: white;
    background: #0b91ce;
  }

  body {
    font-family: 'Nunito', sans-serif;
  }
}

.app_label {
  font-size: 21px;
  font-weight: 600;
  font-style: normal;
}

.separator {
  margin-left: 0;
  margin-right: 0;
  border-color: rgba(255, 255, 255, 0.15);
}
</style>