<script setup lang="ts">
/**
 * src/pages/SettingsPage.vue
 *
 * User settings — language selection and (future) user-type preferences.
 *
 * ── What this page does ───────────────────────────────────────────────────────
 *   • Language picker: lists all active languages from the backend, lets the
 *     user switch the app language.  Selecting a language persists the choice
 *     in languageStore and triggers reactive re-fetching of all content stores.
 *
 *   • User-type preferences: in the legacy app these controlled which content
 *     was shown to the user (e.g. "Student", "Worker").  The user preference
 *     API (/user, /user_type) is not yet ported to the new backend.
 *     A placeholder section is shown with a coming-soon note.
 *
 * ── Language persistence ──────────────────────────────────────────────────────
 *   The selected language is stored in Pinia (languageStore.selected).
 *   It is NOT persisted to localStorage here — persistence will be added when
 *   the user profile API is available.  On reload the app defaults to the
 *   platform default language from public settings.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/ProfileSettings.vue (language section)
 *   New:    src/pages/SettingsPage.vue
 */

import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLanguageStore } from 'src/stores/language-store';
import { logger } from 'src/services/Logger';
import type { Language } from 'src/api/language.api';

const { t } = useI18n();
const langStore = useLanguageStore();

// ─── Actions ──────────────────────────────────────────────────────────────────

function selectLanguage(lang: Language): void {
  langStore.select(lang);
  logger.info('[SettingsPage] language selected', { lang: lang.lang });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  if (langStore.languages.length === 0) {
    await langStore.fetchAll({ active: true });
  }
});
</script>

<template>
  <q-page class="settings-page">

    <!-- ── Language section ────────────────────────────────────────────── -->
    <div class="settings-section-header">
      <q-icon name="translate" size="20px" class="q-mr-sm" />
      {{ t('settings.language') }}
    </div>
    <div class="settings-divider" />

    <!-- Loading -->
    <div v-if="langStore.loading" class="row justify-center q-pa-lg">
      <q-spinner-dots color="primary" size="32px" />
    </div>

    <!-- Language list -->
    <q-list v-else>
      <q-item v-for="lang in langStore.activeLanguages" :key="lang.lang" clickable v-ripple class="settings-item"
        @click="selectLanguage(lang)">
        <q-item-section avatar>
          <q-avatar color="primary" text-color="white" size="40px" class="text-weight-bold">
            {{ lang.lang.slice(0, 2).toUpperCase() }}
          </q-avatar>
        </q-item-section>

        <q-item-section>
          <q-item-label class="settings-label">{{ lang.name }}</q-item-label>
          <q-item-label caption>{{ lang.isoCode ?? lang.lang }}</q-item-label>
        </q-item-section>

        <q-item-section side>
          <q-icon v-if="langStore.selected?.lang === lang.lang ||
            (!langStore.selected && lang.isDefault)" name="check_circle" color="positive"
            size="24px" />
        </q-item-section>
      </q-item>
    </q-list>

    <div class="settings-divider" />

    <!-- ── User type preferences (placeholder) ─────────────────────────── -->
    <div class="settings-section-header">
      <q-icon name="person" size="20px" class="q-mr-sm" />
      {{ t('settings.preferences') }}
    </div>
    <div class="settings-divider" />

    <div class="q-pa-md text-grey-6 text-body2">
      {{ t('settings.preferences_coming_soon') }}
    </div>

    <div class="settings-divider" />

  </q-page>
</template>

<style scoped lang="scss">
.settings-page {
  max-width: 480px;
  margin: 0 auto;
}

.settings-section-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  font-family: 'Nunito', sans-serif;
  font-weight: bold;
  font-size: 16px;
  color: #0f3a5d;
}

.settings-divider {
  background-color: #efefef;
  height: 5px;
}

.settings-item {
  padding: 8px 16px;
}

.settings-label {
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 15px;
}
</style>