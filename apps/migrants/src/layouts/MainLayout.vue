<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from 'src/stores/auth-store';
import { useLanguageStore } from 'src/stores/language-store';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const languageStore = useLanguageStore();
const languageDialog = ref(false);

const isAuth = computed(() => auth.authenticated);
const currentLang = computed(() => languageStore.selected?.lang?.toUpperCase() ?? languageStore.defaultLanguage?.lang?.toUpperCase() ?? 'EN');

const navOptions = computed(() => {
  const base = [
    { label: 'Documents', icon: 'description', to: '/home', auth: false },
    { label: 'Glossary', icon: 'menu_book', to: '/home', auth: false },
    { label: 'Feedback', icon: 'chat_bubble_outline', to: '/home', auth: false },
  ];

  if (isAuth.value) {
    base.push({ label: 'Settings', icon: 'person', to: '/settings', auth: true });
  }

  return base;
});

async function doLogin() {
  await auth.login(window.location.origin + '/home');
}

async function doLogout() {
  await auth.logout(window.location.origin + '/');
}

async function ensureLanguagesLoaded() {
  if (languageStore.languages.length > 0) return;
  await languageStore.fetchAll({ active: true });
  if (!languageStore.selected && languageStore.defaultLanguage) {
    languageStore.select(languageStore.defaultLanguage);
  }
}

function selectLanguage(langCode: string) {
  const lang = languageStore.languages.find((item) => item.lang === langCode);
  if (!lang) return;
  languageStore.select(lang);
  languageDialog.value = false;
}

onMounted(() => {
  void ensureLanguagesLoaded();
});
</script>

<template>
  <q-layout view="hHh lpR fFf" class="micado-layout">
    <q-header elevated class="micado-header">
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          :icon="route.path === '/' ? 'home' : 'home'"
          @click="router.push(isAuth ? '/home' : '/')"
        />

        <q-toolbar-title class="micado-toolbar-title">Home</q-toolbar-title>

        <q-btn
          flat
          round
          dense
          no-caps
          :label="currentLang"
          class="q-mr-sm"
          @click="languageDialog = true"
        />

        <q-btn
          v-if="!isAuth"
          flat
          round
          dense
          icon="login"
          @click="doLogin"
        />

        <q-btn
          v-else
          flat
          round
          dense
          icon="account_circle"
          @click="router.push('/profile')"
        />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer class="micado-footer text-white">
      <q-tabs no-caps align="justify" active-color="orange-7" indicator-color="transparent">
        <q-route-tab
          v-for="nav in navOptions"
          :key="nav.label"
          :to="nav.to"
          :icon="nav.icon"
          :label="nav.label"
        />
      </q-tabs>
    </q-footer>

    <q-dialog v-model="languageDialog">
      <q-card style="min-width: 320px; max-width: 420px; width: 90vw">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Select language</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <q-list bordered separator>
            <q-item
              v-for="language in languageStore.activeLanguages"
              :key="language.lang"
              clickable
              @click="selectLanguage(language.lang)"
            >
              <q-item-section>
                <q-item-label>{{ language.name }}</q-item-label>
                <q-item-label caption>{{ language.lang.toUpperCase() }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon
                  v-if="languageStore.selected?.lang === language.lang || (!languageStore.selected && language.isDefault)"
                  name="check_circle"
                  color="positive"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-page-sticky v-if="isAuth" position="top-right" :offset="[18, 74]">
      <q-btn fab-mini color="primary" icon="logout" @click="doLogout" />
    </q-page-sticky>
  </q-layout>
</template>
