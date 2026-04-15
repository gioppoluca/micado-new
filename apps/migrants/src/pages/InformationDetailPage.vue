<script setup lang="ts">
/**
 * src/pages/InformationDetailPage.vue
 *
 * Detail view for a single published information item.
 *
 * ── Data strategy ─────────────────────────────────────────────────────────────
 *   1. Cache hit  — look up id in contentStore.items (populated by HomePage)
 *   2. Cache miss — call informationApi.getById(id) directly (supports direct
 *      URL access, bookmarks, page refresh without the list being loaded first)
 *   If 404 → redirect to /home.
 *
 * ── Fix vs previous version ───────────────────────────────────────────────────
 *   • getById() replaces the list-scan fallback (list+pageSize:100+find) which
 *     silently failed for items beyond position 100 and on direct URL loads.
 *   • loading.value cleared via finally — no early-return before finally block
 *     (previously the cache-hit branch returned early, leaving the spinner on).
 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useContentStore } from 'src/stores/content-store';
import { useTopicStore } from 'src/stores/topic-store';
import { informationApi } from 'src/api/information.api';
import { useAppStore } from 'src/stores/app-store';
import { useLanguageStore } from 'src/stores/language-store';
import { logger } from 'src/services/Logger';
import type { MigrantInformation } from 'src/api/information.api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contentStore = useContentStore();
const topicStore = useTopicStore();
const appStore = useAppStore();
const langStore = useLanguageStore();

const item = ref<MigrantInformation | null>(null);
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
        // 1 — in-memory cache (populated by HomePage list fetch)
        const cached = contentStore.items.find(i => i.type === 'info' && i.id === id);
        if (cached) {
            item.value = {
                id: cached.id, title: cached.title, description: cached.description,
                lang: cached.lang, categoryId: cached.categoryId ?? null,
                topicIds: cached.topicIds, userTypeIds: [],
            };
            logger.info('[InformationDetailPage] cache hit', { id });
            // ↑ loading cleared in finally — do NOT early-return before finally
        } else {
            // 2 — direct single-item fetch (covers direct URL / bookmark / refresh)
            logger.info('[InformationDetailPage] cache miss, fetching by id', { id });
            item.value = await informationApi.getById(id, getLangParams());
        }
    } catch (e: unknown) {
        // 404 from getById → item not found / not published
        const status = (e as { status?: number })?.status;
        if (status === 404) {
            logger.warn('[InformationDetailPage] not found', { id });
            void router.replace({ name: 'home' });
            return;
        }
        error.value = e instanceof Error ? e.message : 'Unexpected error';
        logger.error('[InformationDetailPage] load failed', { id, error: error.value });
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

            <!-- Orange separator -->
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