// src/stores/features.store.ts
//
// Pinia store — replaces the legacy Vuex features/ module.
// Manages the full flag list for the PA admin UI (enabled + label).
// The boot-time enabled-keys list is handled separately in the boot file.
//
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from 'boot/axios'; // adjust import to your project's axios boot alias

export interface FeatureFlagWithLabel {
    id: number;
    flagKey: string;
    enabled: boolean;
    label: string | null;
}

export const useFeaturesStore = defineStore('features', () => {
    const flags = ref<FeatureFlagWithLabel[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ----------------------------------------------------------------
    // Used by PA admin — loads full list with translated label
    // ----------------------------------------------------------------
    async function fetchFlags(lang?: string) {
        loading.value = true;
        error.value = null;
        try {
            const params = lang ? { lang } : {};
            const { data } = await api.get<FeatureFlagWithLabel[]>('/features-flags', { params });
            flags.value = data;
        } catch (e: unknown) {
            error.value = (e as Error).message ?? 'Failed to load feature flags';
            throw e;
        } finally {
            loading.value = false;
        }
    }

    async function toggleFlag(id: number, enabled: boolean) {
        await api.patch(`/features-flags/${id}`, { enabled });
        const flag = flags.value.find(f => f.id === id);
        if (flag) flag.enabled = enabled;
    }

    async function upsertLabel(flagId: number, lang: string, label: string) {
        await api.post(`/features-flags/${flagId}/labels/${lang}`, { label });
        const flag = flags.value.find(f => f.id === flagId);
        if (flag) flag.label = label;
    }

    return { flags, loading, error, fetchFlags, toggleFlag, upsertLabel };
});