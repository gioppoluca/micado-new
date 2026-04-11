<script setup lang="ts">
/**
 * src/pages/InformationDetailPage.vue
 *
 * Detail view for a single published information item.
 *
 * ── Data strategy ─────────────────────────────────────────────────────────────
 *   There is no dedicated /information-migrant/:id endpoint on the backend.
 *   The page resolves the item in two steps:
 *
 *   1. Cache hit: look up id in contentStore.items (already loaded by HomePage).
 *   2. Cache miss: call informationApi.listForMigrant() with page=1&pageSize=100
 *      and find the item by id. This is the same strategy the legacy app used
 *      (it always fetched the full list and filtered client-side).
 *
 *   If the item is still not found, navigate to 404.
 *
 * ── Content rendering ─────────────────────────────────────────────────────────
 *   Description is stored as Markdown (tiptap-markdown).
 *   For now it is rendered as pre-formatted plain text.
 *   Replace the <div style="white-space: pre-wrap"> block with <RichTextViewer>
 *   once that component is ported to the migrants frontend.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/InformationItem.vue + components/single_items/SingleItemInformation.vue
 *   New:    src/pages/InformationDetailPage.vue (self-contained)
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

// ─── Stores & router ─────────────────────────────────────────────────────────

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contentStore = useContentStore();
const topicStore = useTopicStore();
const appStore = useAppStore();
const langStore = useLanguageStore();

// ─── State ────────────────────────────────────────────────────────────────────

const item = ref<MigrantInformation | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

// ─── Computed ─────────────────────────────────────────────────────────────────

/** Numeric id from the route param. */
const itemId = computed(() => Number(route.params['id']));

/** Topic labels for the tag chips. */
const topicLabels = computed(() =>
    (item.value?.topicIds ?? [])
        .map(id => topicStore.getById(id)?.topic)
        .filter((t): t is string => Boolean(t)),
);

// ─── Data loading ─────────────────────────────────────────────────────────────

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
        // Step 1 — cache hit in contentStore
        const cached = contentStore.items.find(i => i.type === 'info' && i.id === id);
        if (cached) {
            // contentStore uses UnifiedContentItem shape — cast to MigrantInformation
            item.value = {
                id: cached.id,
                title: cached.title,
                description: cached.description,
                lang: cached.lang,
                categoryId: cached.categoryId ?? null,
                topicIds: cached.topicIds,
                userTypeIds: [],
            };
            logger.info('[InformationDetailPage] resolved from cache', { id });
            return;
        }

        // Step 2 — fallback: fetch list and find by id
        logger.info('[InformationDetailPage] cache miss, fetching list', { id });
        const list = await informationApi.listForMigrant({
            ...getLangParams(),
            page: 1,
            pageSize: 100,
        });
        const found = list.find(i => i.id === id) ?? null;

        if (!found) {
            logger.warn('[InformationDetailPage] item not found', { id });
            void router.replace({ name: 'not-found' });
            return;
        }
        item.value = found;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Unexpected error';
        logger.error('[InformationDetailPage] load failed', { id, error: error.value });
    } finally {
        loading.value = false;
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    if (topicStore.topics.length === 0) await topicStore.fetchAll();
    await load(itemId.value);
});

// Re-load when the user navigates to a different info item without leaving the page
watch(itemId, async (newId) => {
    await load(newId);
});
</script>

<template>
    <q-page class="info-detail-page q-px-lg q-pt-md">

        <!-- Loading -->
        <div v-if="loading" class="row justify-center q-pa-xl">
            <q-spinner-dots color="primary" size="40px" />
        </div>

        <!-- Error -->
        <q-banner v-else-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error_outline" /></template>
            {{ error }}
            <template #action>
                <q-btn flat :label="t('desc_labels.retry')" @click="load(itemId)" />
            </template>
        </q-banner>

        <!-- Content -->
        <template v-else-if="item">

            <!-- Title row -->
            <div class="row items-start q-mb-sm">
                <div class="info-title col">{{ item.title }}</div>
            </div>

            <!-- Orange separator — matches legacy .title-separator -->
            <div class="info-separator q-mb-md" />

            <!-- Description (Markdown as plain text until RichTextViewer is ported) -->
            <div v-if="item.description" class="info-description q-mb-lg" style="white-space: pre-wrap;">
                {{ item.description }}
            </div>

            <q-separator class="q-mb-md" />

            <!-- Topic tags -->
            <div v-if="topicLabels.length" class="q-mb-sm">
                <div class="text-caption text-grey-6 q-mb-xs">
                    {{ t('information_centre.topics') }}
                </div>
                <div class="row q-gutter-xs">
                    <q-chip v-for="label in topicLabels" :key="label" dense color="primary" text-color="white"
                        :label="label" />
                </div>
            </div>

            <!-- Back button -->
            <div class="row justify-center q-pt-md q-pb-xl">
                <q-btn outline rounded no-caps icon="arrow_back" :label="t('button.go_back')" class="go-back-btn"
                    @click="router.back()" />
            </div>

        </template>

    </q-page>
</template>

<style scoped lang="scss">
.info-detail-page {
    max-width: 540px;
    margin: 0 auto;
}

.info-title {
    font-family: 'Nunito', sans-serif;
    font-weight: bold;
    font-size: 18px;
    line-height: 25px;
    color: #0f3a5d;
}

// Full-bleed orange separator (legacy: .title-separator)
.info-separator {
    height: 3px;
    background-color: $accent;
    margin-left: -35px;
    margin-right: -35px;
    width: calc(100% + 70px);
}

.info-description {
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