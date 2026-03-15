<template>
    <q-card bordered class="q-ma-md">
        <q-card-section>
            <HelpLabel :field-label="t('data_settings.feature_settings')" :help-label="t('help.feature_settings')" />
        </q-card-section>
        <q-separator />
        <q-card-section>
            <q-inner-loading :showing="featuresStore.loading" />

            <FeaturesElement v-for="flag in featuresStore.flags" :key="flag.id" :feature="flag"
                @update="onFlagUpdate" />

            <q-banner v-if="featuresStore.error" class="bg-negative text-white q-mt-sm" dense rounded>
                {{ featuresStore.error }}
            </q-banner>

            <div class="text-right q-mt-md">
                <q-btn class="button" no-caps :label="t('button.save')" :loading="saving" @click="saveAll" />
            </div>
        </q-card-section>
    </q-card>
</template>

<script setup lang="ts">
/**
 * SettingsSectionFeatures
 *
 * Displays all feature flags as toggles and saves them via
 * PATCH /features-flags/{id} per changed flag.
 *
 * The old app called updateAllFeatures(workingFeatures) which sent the entire
 * array in one call. The new API patches individual flags, so we diff the
 * pending changes and send only what changed.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeaturesStore } from 'src/stores/features-store';
import type { FeatureFlag } from 'src/api/features.api';
import FeaturesElement from 'src/components/settings/FeaturesElement.vue';
import HelpLabel from 'src/components/HelpLabel.vue';

const { t } = useI18n();
const featuresStore = useFeaturesStore();

// Track pending changes: flagId → new enabled value
const pending = ref<Map<number, boolean>>(new Map());
const saving = ref(false);

function onFlagUpdate(flag: FeatureFlag): void {
    // Find original value
    const original = featuresStore.flags.find(f => f.id === flag.id);
    if (original?.enabled === flag.enabled) {
        pending.value.delete(flag.id);
    } else {
        pending.value.set(flag.id, flag.enabled);
    }
}

async function saveAll(): Promise<void> {
    if (pending.value.size === 0) return;
    saving.value = true;
    const patches = Array.from(pending.value.entries()).map(
        ([id, enabled]) => featuresStore.patchOne(id, { enabled }),
    );
    await Promise.all(patches);
    pending.value.clear();
    saving.value = false;
}
</script>

<style scoped>
.button {
    background: #0f3a5d;
    border-radius: 5px;
    color: white;
    min-width: 150px;
}
</style>