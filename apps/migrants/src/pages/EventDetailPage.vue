<script setup lang="ts">
/**
 * src/pages/EventDetailPage.vue
 *
 * Detail view for a single published event.
 * Mirrors InformationDetailPage data strategy (cache-first, API fallback).
 *
 * Legacy: src/pages/EventItem.vue + components/single_items/SingleItemEvent.vue
 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useContentStore } from 'src/stores/content-store';
import { useTopicStore } from 'src/stores/topic-store';
import { eventApi } from 'src/api/event.api';
import { useAppStore } from 'src/stores/app-store';
import { useLanguageStore } from 'src/stores/language-store';
import { logger } from 'src/services/Logger';
import type { MigrantEvent } from 'src/api/event.api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contentStore = useContentStore();
const topicStore = useTopicStore();
const appStore = useAppStore();
const langStore = useLanguageStore();

const item = ref<MigrantEvent | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const itemId = computed(() => Number(route.params['id']));

const topicLabels = computed(() =>
    (item.value?.topicIds ?? [])
        .map(id => topicStore.getById(id)?.topic)
        .filter((l): l is string => Boolean(l)),
);

/** Format an ISO date string using the current locale. */
function formatDate(iso: string | undefined): string {
    if (!iso) return '';
    const lang = langStore.selected?.lang ?? 'en';
    try {
        return new Date(iso).toLocaleString(lang, {
            weekday: 'long', day: '2-digit', month: 'long',
            year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return new Date(iso).toLocaleString('en');
    }
}

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
        const cached = contentStore.items.find(i => i.type === 'event' && i.id === id);
        if (cached) {
            item.value = {
                id: cached.id, title: cached.title, description: cached.description,
                lang: cached.lang,
                startDate: cached.startDate ?? '',
                endDate: cached.endDate ?? '',
                location: cached.location ?? null,
                cost: null, isFree: true,
                categoryId: cached.categoryId ?? null,
                topicIds: cached.topicIds, userTypeIds: [],
            };
            logger.info('[EventDetailPage] cache hit', { id });
            // ↑ loading cleared in finally — do NOT early-return before finally
        } else {
            // 2 — direct single-item fetch (covers direct URL / bookmark / refresh)
            logger.info('[EventDetailPage] cache miss, fetching by id', { id });
            item.value = await eventApi.getById(id, getLangParams());
        }
    } catch (e: unknown) {
        // 404 from getById → item not found / not published
        const status = (e as { status?: number })?.status;
        if (status === 404) {
            logger.warn('[EventDetailPage] not found', { id });
            void router.replace({ name: 'home' });
            return;
        }
        error.value = e instanceof Error ? e.message : 'Unexpected error';
        logger.error('[EventDetailPage] load failed', { id, error: error.value });
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

            <!-- Event metadata rows -->
            <q-list dense class="q-mb-md">
                <q-item v-if="item.startDate">
                    <q-item-section avatar>
                        <q-icon name="event" color="primary" />
                    </q-item-section>
                    <q-item-section>
                        <q-item-label caption>{{ t('event_detail.start_date') }}</q-item-label>
                        <q-item-label>{{ formatDate(item.startDate) }}</q-item-label>
                    </q-item-section>
                </q-item>

                <q-item v-if="item.endDate">
                    <q-item-section avatar>
                        <q-icon name="event_available" color="primary" />
                    </q-item-section>
                    <q-item-section>
                        <q-item-label caption>{{ t('event_detail.finish_date') }}</q-item-label>
                        <q-item-label>{{ formatDate(item.endDate) }}</q-item-label>
                    </q-item-section>
                </q-item>

                <q-item>
                    <q-item-section avatar>
                        <q-icon name="euro" color="primary" />
                    </q-item-section>
                    <q-item-section>
                        <q-item-label caption>{{ t('event_detail.cost') }}</q-item-label>
                        <q-item-label>
                            {{ item.isFree ? t('event_detail.cost_free') : (item.cost ?? t('event_detail.cost_free')) }}
                        </q-item-label>
                    </q-item-section>
                </q-item>

                <q-item v-if="item.location">
                    <q-item-section avatar>
                        <q-icon name="place" color="primary" />
                    </q-item-section>
                    <q-item-section>
                        <q-item-label caption>{{ t('event_detail.location') }}</q-item-label>
                        <q-item-label>{{ item.location }}</q-item-label>
                    </q-item-section>
                </q-item>
            </q-list>

            <!-- Topic chips -->
            <div v-if="topicLabels.length" class="q-mb-md">
                <div class="text-caption text-grey-6 q-mb-xs">{{ t('event_detail.topics') }}</div>
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