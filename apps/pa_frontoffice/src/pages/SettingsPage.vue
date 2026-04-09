<template>
  <q-page padding>
    <div v-if="loading" class="row items-center justify-center" style="min-height: 60vh">
      <q-spinner size="3rem" color="accent" />
    </div>
    <div v-else class="q-pa-md">
      <h5 class="q-mt-none">{{ t('data_settings.settings') }}</h5>
      <ActiveLanguageSelector />
      <LanguageManager />
      <SettingsSectionFeatures />
      <SettingsSectionTopics />
      <SettingsSectionSurvey />
      <SettingsSectionHelpdesk />
      <!--
        TODO: Requires PATCH /settings endpoint (not in OpenAPI yet)
        <SettingsSectionPolicies />
      -->
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLanguageStore } from 'src/stores/language-store';
import { useFeaturesStore } from 'src/stores/features-store';
import { useAppStore } from 'src/stores/app-store';
import ActiveLanguageSelector from 'src/components/settings/ActiveLanguageSelector.vue';
import LanguageManager from 'src/components/settings/LanguageManager.vue';
import SettingsSectionFeatures from 'src/pages/settings/SettingsSectionFeatures.vue';
import SettingsSectionSurvey from 'src/pages/settings/SettingsSectionSurvey.vue';
import SettingsSectionHelpdesk from 'src/pages/settings/SettingsSectionHelpdesk.vue';
import SettingsSectionTopics from 'src/pages/settings/SettingsSectionTopics.vue';
import { trackEvent } from 'src/services/analytics';


const { t } = useI18n();
const langStore = useLanguageStore();
const featuresStore = useFeaturesStore();
const appStore = useAppStore();
const loading = ref(true);

onMounted(async () => {
  const fetchLanguages = langStore.languages.length === 0
    ? langStore.fetchAll()
    : Promise.resolve();
  await Promise.all([
    fetchLanguages,
    featuresStore.fetchAll(appStore.userLang),
  ]);
  loading.value = false;
  trackEvent('settings-open-section', {
    section: 'translation-management',
  });
});
</script>