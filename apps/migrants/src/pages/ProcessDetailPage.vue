<script setup lang="ts">
/**
 * src/pages/ProcessDetailPage.vue
 *
 * Detail view for a single published process / step-by-step guide.
 *
 * ── Note on the process graph ─────────────────────────────────────────────────
 *   The legacy app rendered an interactive Mermaid diagram (vue-mermaid) with
 *   clickable steps pulled from the graph endpoint. That endpoint
 *   (GET /processes/:id/graph) is PA-authenticated only and the dependency
 *   vue-mermaid is not in the new stack.
 *
 *   This page renders:
 *   • Title + description  (from the migrant list endpoint)
 *   • Topic chips
 *   • A note that the full step-by-step diagram requires login (if it is ever
 *     exposed as a public migrant endpoint, wire it here).
 *
 * Legacy: src/pages/ProcessViewer.vue + Processes.vue
 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useContentStore } from 'src/stores/content-store';
import { useTopicStore } from 'src/stores/topic-store';
import { processApi } from 'src/api/process.api';
import { useAppStore } from 'src/stores/app-store';
import { useLanguageStore } from 'src/stores/language-store';
import { logger } from 'src/services/Logger';
import type { MigrantProcess } from 'src/api/process.api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contentStore = useContentStore();
const topicStore = useTopicStore();
const appStore = useAppStore();
const langStore = useLanguageStore();

const item = ref<MigrantProcess | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const itemId = computed(() => Number(route.params['id']));

const topicLabels = computed(() =>
    (item.value?.topicIds ?? [])
        .map(id => topicStore.getById(id)?.topic)
        .filter((l): l is string => Boolean(l)),
);

function getLangParams() {
    return {
        defaultlang: appStore.defaultLang || 'it',
        currentlang: langStore.selected?.lang || appStore.defaultLang || 'it',
    };
}

async function load(id: number): Promise<void> {
    loading.value = true;
    error.value = null;
    item.value = null;

    try {
        // 1 — cache hit
        const cached = contentStore.items.find(i => i.type === 'process' && i.id === id);
        if (cached) {
            item.value = {
                id: cached.id, title: cached.title, description: cached.description,
                lang: cached.lang, topicIds: cached.topicIds, userTypeIds: [],
            };
            logger.info('[ProcessDetailPage] cache hit', { id });
            return;
        }

        // 2 — API fallback
        logger.info('[ProcessDetailPage] cache miss, fetching', { id });
        const list = await processApi.listForMigrant({
            ...getLangParams(), page: 1, pageSize: 100,
        });
        const found = list.find(i => i.id === id) ?? null;
        if (!found) {
            logger.warn('[ProcessDetailPage] not found', { id });
            void router.replace('/home');
            return;
        }
        item.value = found;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Unexpected error';
        logger.error('[ProcessDetailPage] load failed', { id, error: error.value });
    } finally {
        loading.value = false;
    }
}

onMounted(async () => {
    if (topicStore.topics.length === 0) await topicStore.fetchAll();
    await load(itemId.value);
});

watch(itemId, (newId) => { void load(newId); });
</script>

<template>
    <q-page class="detail-page q-px-lg q-pt-md">

        <div v-if="loading" class="row justify-center q-pa-xl">
            <q-spinner-dots color="primary" size="40px" />
        </div>

        <q-banner v-else-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error_outline" /></template>
            {{ error }}
            <template #action>
                <q-btn flat :label="t('desc_labels.retry')" @click="load(itemId.valueOf())" />
            </template>
        </q-banner>

        <template v-else-if="item">

            <!-- Title -->
            <div class="detail-title q-mb-sm">{{ item.title }}</div>
            <div class="detail-separator q-mb-md" />

            <!-- Description -->
            <div v-if="item.description" class="detail-body q-mb-lg" style="white-space: pre-wrap;">
                {{ item.description }}
            </div>

            <q-separator class="q-mb-md" />

            <!-- Topic chips -->
            <div v-if="topicLabels.length" class="q-mb-md">
                <div class="text-caption text-grey-6 q-mb-xs">{{ t('information_centre.topics') }}</div>
                <div class="row q-gutter-xs">
                    <q-chip v-for="label in topicLabels" :key="label" dense color="primary" text-color="white"
                        :label="label" />
                </div>
            </div>

            <!-- Back -->
            <div class="row justify-center q-pt-md q-pb-xl">
                <q-btn outline rounded no-caps icon="arrow_back" :label="t('button.go_back')" class="go-back-btn"
                    @click="router.back()" />
            </div>

        </template>
    </q-page>
</template>

<style scoped lang="scss">
.detail-page {
    max-width: 540px;
    margin: 0 auto;
}

.detail-title {
    font-family: 'Nunito', sans-serif;
    font-weight: bold;
    font-size: 18px;
    line-height: 25px;
    color: #0f3a5d;
}

.detail-separator {
    height: 3px;
    background-color: $accent;
    margin-left: -35px;
    margin-right: -35px;
    width: calc(100% + 70px);
}

.detail-body {
    font-size: 14px;
    line-height: 20px;
    color: #333;
}

.go-back-btn {
    border-color: $accent;
    color: $accent;
    min-width: 180px;
}
</style>