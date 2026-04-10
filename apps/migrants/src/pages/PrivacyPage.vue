<template>
    <q-page class="q-pa-lg">
        <div class="text-h4 q-mb-md">{{ t('privacy.pageTitle') }}</div>

        <div class="text-body1 q-mb-lg">
            {{ t('privacy.pageIntro') }}
        </div>

        <q-card flat bordered class="q-mb-lg">
            <q-card-section>
                <div class="text-h6 q-mb-sm">{{ t('privacy.preferencesTitle') }}</div>
                <div class="text-body2 q-mb-md">
                    {{ t('privacy.preferencesDescription') }}
                </div>

                <q-btn color="primary" no-caps icon="settings" :label="t('privacy.managePreferences')"
                    @click="showPreferences" />
            </q-card-section>
        </q-card>

        <q-card flat bordered>
            <q-card-section>
                <div class="text-h6 q-mb-sm">{{ t('privacy.currentStateTitle') }}</div>

                <q-list separator>
                    <q-item>
                        <q-item-section>{{ t('consent.services.usageTracker.title') }}</q-item-section>
                        <q-item-section side>{{ state.services.usageTracker ? 'ON' : 'OFF' }}</q-item-section>
                    </q-item>
                    <q-item>
                        <q-item-section>{{ t('consent.services.youtubeEmbed.title') }}</q-item-section>
                        <q-item-section side>{{ state.services.youtubeEmbed ? 'ON' : 'OFF' }}</q-item-section>
                    </q-item>
                    <q-item>
                        <q-item-section>{{ t('consent.services.atlasEmbed.title') }}</q-item-section>
                        <q-item-section side>{{ state.services.atlasEmbed ? 'ON' : 'OFF' }}</q-item-section>
                    </q-item>
                    <q-item>
                        <q-item-section>{{ t('consent.services.supportWidget.title') }}</q-item-section>
                        <q-item-section side>{{ state.services.supportWidget ? 'ON' : 'OFF' }}</q-item-section>
                    </q-item>
                </q-list>
            </q-card-section>
        </q-card>
    </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useConsent } from 'src/composables/useConsent';

const { t } = useI18n();
const { state, showPreferences } = useConsent();
</script>