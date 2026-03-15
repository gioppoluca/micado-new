<template>
    <q-toggle v-model="localEnabled" :label="label" color="secondary" @update:model-value="onToggle" />
</template>

<script setup lang="ts">
/**
 * FeaturesElement — single feature-flag toggle row.
 *
 * Migration notes:
 *  - Replaced editEntityMixin.filterTranslationModel + activeLanguage with a
 *    direct lookup using appStore.userLang (same source, no mixin needed).
 *  - v-on:input → @update:model-value (Vue 3 / Quasar 2).
 *  - Emits 'update' instead of 'input' to match Vue 3 naming conventions.
 *  - Uses a local copy of `enabled` so the toggle feels instant while the
 *    parent decides whether to persist (optimistic UI).
 */
import { ref, computed } from 'vue';
import { useAppStore } from 'src/stores/app-store';
import type { FeatureFlag } from 'src/api/features.api';

const props = defineProps<{
    feature: FeatureFlag
}>()

const emit = defineEmits<{
    (e: 'update', feature: FeatureFlag): void
}>()

const appStore = useAppStore();

// Local reactive copy so the toggle responds instantly
const localEnabled = ref(props.feature.enabled);

/** Display label: prefer label in userLang, fall back to first available, then flagKey. */
const label = computed<string>(() => {
    if (!props.feature.labels?.length) return props.feature.flagKey;
    const match = props.feature.labels.find(l => l.lang === appStore.userLang)
        ?? props.feature.labels[0];
    return match?.label ?? props.feature.flagKey;
});

function onToggle(val: boolean): void {
    emit('update', { ...props.feature, enabled: val });
}
</script>