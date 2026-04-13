<template>
    <q-chip dense square :color="cfg.color" :text-color="cfg.textColor" :class="cfg.pulse ? 'status-pulse' : ''">
        <q-icon :name="cfg.icon" size="0.9rem" class="q-mr-xs" />
        {{ cfg.label }}
    </q-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TranslationStatus } from 'src/api/translation-monitor.api';

const props = withDefaults(defineProps<{
    status: TranslationStatus | null;
}>(), {
    status: null,
});

const cfg = computed(() => {
    switch (props.status) {
        case 'DONE':
            return { color: 'positive', textColor: 'white', icon: 'check_circle', label: 'DONE', pulse: false };
        case 'WAITING_TRANSLATION':
            return { color: 'amber-7', textColor: 'white', icon: 'hourglass_empty', label: 'WAITING', pulse: false };
        case 'RECEIVED_TRANSLATION':
            return { color: 'secondary', textColor: 'white', icon: 'download_done', label: 'RECEIVED', pulse: true };
        case 'GENERATING_MP3':
            return { color: 'info', textColor: 'white', icon: 'graphic_eq', label: 'MP3', pulse: true };
        case 'SAVING_TO_DB':
            return { color: 'info', textColor: 'white', icon: 'save', label: 'SAVING', pulse: true };
        case 'TIMEOUT':
            return { color: 'warning', textColor: 'white', icon: 'timer_off', label: 'TIMEOUT', pulse: false };
        case 'ERROR':
            return { color: 'negative', textColor: 'white', icon: 'error_outline', label: 'ERROR', pulse: false };
        default:
            return { color: 'grey-4', textColor: 'grey-8', icon: 'radio_button_unchecked', label: '—', pulse: false };
    }
});
</script>

<style scoped>
.status-pulse {
    animation: pulse 1.8s ease-in-out infinite;
}

@keyframes pulse {

    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.55;
    }
}
</style>