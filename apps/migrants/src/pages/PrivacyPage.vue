<script setup lang="ts">
/**
 * src/pages/PrivacyPage.vue
 *
 * Privacy policy page.
 *
 * ── Content source ────────────────────────────────────────────────────────────
 *   The privacy policy text comes from the public settings key 'policy'
 *   (legacy key name preserved).  It is stored as plain text or Markdown.
 *   If the setting is missing the page shows a fallback message.
 *
 * ── Consent state ────────────────────────────────────────────────────────────
 *   A collapsed section shows the current on/off state of each optional
 *   service and lets the user reopen the Klaro preference dialog.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/Privacy.vue (Vue 2 / Vuex)
 *   New:    src/pages/PrivacyPage.vue (Vue 3 / Pinia)
 */

import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from 'src/stores/settings-store';
import { useConsent } from 'src/composables/useConsent';

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();
const { state, showPreferences } = useConsent();

// Privacy text from settings key 'policy' (mirrors legacy).
const privacyText = computed(() => settingsStore.get('policy') || null);

function goBack(): void {
    router.go(-1);
}

onMounted(async () => {
    if (settingsStore.settings.length === 0) {
        await settingsStore.fetchAll();
    }
});
</script>

<template>
    <q-page class="privacy-page q-pa-md">

        <!-- Title -->
        <div class="text-weight-bold text-primary privacy-title q-mb-md">
            {{ t('privacy.privacy') }}
        </div>

        <!-- Policy text from settings -->
        <div v-if="privacyText" class="privacy-body q-mb-lg" style="white-space: pre-wrap;">
            {{ privacyText }}
        </div>
        <q-banner v-else class="bg-grey-2 text-grey-7 q-mb-lg" rounded>
            <template #avatar><q-icon name="info" /></template>
            {{ t('privacy.notAvailable') }}
        </q-banner>

        <!-- Cookie preferences section -->
        <q-expansion-item icon="cookie" :label="t('privacy.currentStateTitle')" header-class="text-weight-medium"
            class="q-mb-md">
            <q-card flat>
                <q-card-section class="q-pt-none">
                    <q-list separator>
                        <q-item>
                            <q-item-section>{{ t('consent.services.usageTracker.title') }}</q-item-section>
                            <q-item-section side>
                                <q-badge :color="state.services.usageTracker ? 'positive' : 'grey-5'">
                                    {{ state.services.usageTracker ? 'ON' : 'OFF' }}
                                </q-badge>
                            </q-item-section>
                        </q-item>
                        <q-item>
                            <q-item-section>{{ t('consent.services.youtubeEmbed.title') }}</q-item-section>
                            <q-item-section side>
                                <q-badge :color="state.services.youtubeEmbed ? 'positive' : 'grey-5'">
                                    {{ state.services.youtubeEmbed ? 'ON' : 'OFF' }}
                                </q-badge>
                            </q-item-section>
                        </q-item>
                        <q-item>
                            <q-item-section>{{ t('consent.services.atlasEmbed.title') }}</q-item-section>
                            <q-item-section side>
                                <q-badge :color="state.services.atlasEmbed ? 'positive' : 'grey-5'">
                                    {{ state.services.atlasEmbed ? 'ON' : 'OFF' }}
                                </q-badge>
                            </q-item-section>
                        </q-item>
                        <q-item>
                            <q-item-section>{{ t('consent.services.supportWidget.title') }}</q-item-section>
                            <q-item-section side>
                                <q-badge :color="state.services.supportWidget ? 'positive' : 'grey-5'">
                                    {{ state.services.supportWidget ? 'ON' : 'OFF' }}
                                </q-badge>
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <div class="q-mt-md">
                        <q-btn unelevated no-caps color="primary" icon="settings"
                            :label="t('privacy.managePreferences')" @click="showPreferences" />
                    </div>
                </q-card-section>
            </q-card>
        </q-expansion-item>

        <!-- Back button -->
        <div class="row justify-center q-pt-md q-pb-xl">
            <q-btn outline rounded no-caps icon="arrow_back" :label="t('button.go_back')" class="go-back-btn"
                @click="goBack" />
        </div>

    </q-page>
</template>

<style scoped lang="scss">
.privacy-page {
    max-width: 540px;
    margin: 0 auto;
}

.privacy-title {
    font-size: 16px;
    line-height: 22px;
    color: #0f3a5d;
}

.privacy-body {
    font-size: 14px;
    line-height: 20px;
    color: #333;
}

.go-back-btn {
    border-color: #0f3a5d;
    color: #0f3a5d;
    min-width: 180px;
}
</style>