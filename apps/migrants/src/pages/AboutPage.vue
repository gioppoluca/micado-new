<script setup lang="ts">
/**
 * src/pages/AboutPage.vue
 *
 * "More" / About page — a simple navigation menu.
 *
 * ── Items ─────────────────────────────────────────────────────────────────────
 *   • Show welcome page again  — resets localStorage flag and goes to /
 *   • Privacy policy           — navigates to /privacy
 *   • Manage cookies           — opens Klaro consent dialog
 *   • Powered by / Funding     — navigates to /powered-by
 *   • Survey (optional)        — shown only when setting key 'survey_local' or
 *                                'survey_en' is present; opens as external link.
 *                                Full in-app survey (survey-vue) is not yet ported.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/About.vue (Vue 2 / Vuex / Options API)
 *   New:    src/pages/AboutPage.vue (Vue 3 / Pinia / Composition API)
 */

import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from 'src/stores/settings-store';
import { useConsent } from 'src/composables/useConsent';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();
const { showPreferences } = useConsent();

// ─── Survey link (external) ───────────────────────────────────────────────────

/** URL of the external survey in the user's language, or English fallback. */
const surveyUrl = computed(() => {
    const local = settingsStore.get('survey_local');
    const en = settingsStore.get('survey_en');
    return local || en || null;
});

const surveyVisible = computed(() => surveyUrl.value !== null);

// ─── Actions ──────────────────────────────────────────────────────────────────

function goToWelcome(): void {
    // Reset the "skip welcome" preference so the page shows again.
    localStorage.removeItem('showWelcome');
    logger.info('[AboutPage] welcome page re-enabled');
    void router.push({ name: 'welcome' });
}

function openSurvey(): void {
    if (surveyUrl.value) {
        window.open(surveyUrl.value, '_blank', 'noopener,noreferrer');
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    if (settingsStore.settings.length === 0) {
        await settingsStore.fetchAll();
    }
});
</script>

<template>
    <q-page class="about-page">

        <!-- Optional: survey link -->
        <template v-if="surveyVisible">
            <q-item clickable v-ripple class="about-item" @click="openSurvey">
                <q-item-section avatar>
                    <q-icon name="poll" color="primary" size="30px" />
                </q-item-section>
                <q-item-section>
                    <q-item-label class="about-label">{{ t('desc_labels.survey_desc') }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                    <q-icon name="open_in_new" color="grey-5" size="18px" />
                </q-item-section>
            </q-item>
            <div class="about-divider" />
        </template>

        <!-- Show welcome page again -->
        <q-item clickable v-ripple class="about-item" @click="goToWelcome">
            <q-item-section avatar>
                <q-icon name="home" color="primary" size="30px" />
            </q-item-section>
            <q-item-section>
                <q-item-label class="about-label">{{ t('menu.welcome') }}</q-item-label>
            </q-item-section>
        </q-item>
        <div class="about-divider" />

        <!-- Privacy policy -->
        <q-item clickable v-ripple class="about-item" :to="{ name: 'privacy' }">
            <q-item-section avatar>
                <q-icon name="privacy_tip" color="primary" size="30px" />
            </q-item-section>
            <q-item-section>
                <q-item-label class="about-label">{{ t('menu.policy') }}</q-item-label>
            </q-item-section>
        </q-item>
        <div class="about-divider" />

        <!-- Cookie / consent manager -->
        <q-item clickable v-ripple class="about-item" @click="showPreferences">
            <q-item-section avatar>
                <q-icon name="cookie" color="primary" size="30px" />
            </q-item-section>
            <q-item-section>
                <q-item-label class="about-label">{{ t('menu.consent') }}</q-item-label>
            </q-item-section>
        </q-item>
        <div class="about-divider" />

        <!-- Powered by / funding -->
        <q-item clickable v-ripple class="about-item" :to="{ name: 'powered-by' }">
            <q-item-section avatar>
                <q-icon name="volunteer_activism" color="primary" size="30px" />
            </q-item-section>
            <q-item-section>
                <q-item-label class="about-label">{{ t('menu.funding') }}</q-item-label>
            </q-item-section>
        </q-item>
        <div class="about-divider" />

    </q-page>
</template>

<style scoped lang="scss">
.about-page {
    max-width: 540px;
    margin: 0 auto;
}

// Grey 5px divider — matches legacy separator style
.about-divider {
    background-color: #efefef;
    height: 5px;
}

.about-item {
    padding: 12px 16px;
}

.about-label {
    font-family: 'Nunito', sans-serif;
    font-weight: bold;
    font-size: 18px;
    line-height: 25px;
    color: #0f3a5d;
}
</style>