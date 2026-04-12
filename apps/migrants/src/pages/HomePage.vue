<script setup lang="ts">
/**
 * src/pages/HomePage.vue
 *
 * Main public home page — topic navigation + unified content list.
 *
 * ── Structure ─────────────────────────────────────────────────────────────────
 *   1. Breadcrumb: Home → Topic A → Sub-topic B
 *   2. Search bar (client-side filter over current items)
 *   3. Sub-topic grid (children of the active topic)
 *   4. Unified content list (info + process + event) — infinite scroll
 *
 * ── URL state ─────────────────────────────────────────────────────────────────
 *   ?topicId=<id>  optional; sets the active topic on mount (from WelcomePage)
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/TopicChoices.vue (Vue 2 / Vuex)
 *   New:    src/pages/HomePage.vue     (Vue 3 / Pinia)
 */

import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useTopicStore } from 'src/stores/topic-store';
import { useContentStore } from 'src/stores/content-store';
import type { UnifiedContentItem } from 'src/stores/content-store';
import { logger } from 'src/services/Logger';
import type { MigrantTopic } from 'src/api/topic.api';
import TopicIcon from 'src/components/TopicIcon.vue';

// ─── Stores & router ─────────────────────────────────────────────────────────

const { t } = useI18n();
const topicStore = useTopicStore();
const contentStore = useContentStore();
const route = useRoute();
const router = useRouter();

// ─── Breadcrumb state ─────────────────────────────────────────────────────────

/**
 * Stack of topics the user has drilled into.
 * Empty = root (all topics visible, all content shown).
 */
const breadcrumbs = ref<MigrantTopic[]>([]);

const activeTopic = computed<number | null>(() =>
  breadcrumbs.value.length > 0
    ? (breadcrumbs.value[breadcrumbs.value.length - 1]?.id ?? null)
    : null,
);

// ─── Search state ─────────────────────────────────────────────────────────────

const searchText = ref('');

// ─── Computed ─────────────────────────────────────────────────────────────────

/** Child topics of the active topic (or root topics when none selected). */
const visibleTopics = computed<MigrantTopic[]>(() =>
  topicStore.topics.filter(t => t.father === activeTopic.value),
);

/** Client-side search filter over the merged content items. */
const filteredItems = computed<UnifiedContentItem[]>(() => {
  const query = searchText.value.trim().toLowerCase();
  if (!query) return contentStore.items;
  return contentStore.items.filter(
    item =>
      item.title.toLowerCase().includes(query) ||
      (item.description ?? '').toLowerCase().includes(query),
  );
});

// ─── Icon / colour maps per content type ─────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  info: 'info',
  process: 'linear_scale',
  event: 'event',
};

const TYPE_COLORS: Record<string, string> = {
  info: 'primary',
  process: 'primary',
  event: 'accent',
};

// ─── Navigation helpers ───────────────────────────────────────────────────────

async function drillInto(topic: MigrantTopic): Promise<void> {
  logger.info('[HomePage] drill into topic', { id: topic.id, label: topic.topic });
  breadcrumbs.value = [...breadcrumbs.value, topic];
  await contentStore.setTopicFilter([topic.id]);
}

async function navigateToBreadcrumb(index: number): Promise<void> {
  breadcrumbs.value = breadcrumbs.value.slice(0, index + 1);
  const topic = breadcrumbs.value[index];
  await contentStore.setTopicFilter(topic ? [topic.id] : []);
}

async function goHome(): Promise<void> {
  breadcrumbs.value = [];
  await contentStore.clearFilters();
}

function openItem(item: UnifiedContentItem): void {
  logger.info('[HomePage] open item', { type: item.type, id: item.id });
  void router.push({ path: `/${item.type}/${item.id}` });
}

// ─── Date helper ─────────────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Infinite scroll ─────────────────────────────────────────────────────────

async function onLoad(_index: number, done: (stop?: boolean) => void): Promise<void> {
  if (!contentStore.hasMore) { done(true); return; }
  await contentStore.loadNextPage();
  done(!contentStore.hasMore);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  logger.info('[HomePage] mounted');
  if (topicStore.topics.length === 0) await topicStore.fetchAll();

  const queryTopicId = route.query['topicId'];
  if (queryTopicId) {
    const id = Number(queryTopicId);
    const topic = topicStore.getById(id);
    if (topic) {
      breadcrumbs.value = [topic];
      await contentStore.setTopicFilter([id]);
    } else {
      await contentStore.fetchAll();
    }
    void router.replace({ query: {} });
  } else {
    await contentStore.fetchAll();
  }
});

// Re-fetch when language changes — content-store handles it internally,
// but we also clear local search to avoid stale highlighted text.
watch(
  () => contentStore.items,
  () => { searchText.value = ''; },
);
</script>

<template>
  <q-page class="home-page">

    <!-- ── Breadcrumb ──────────────────────────────────────────────────────── -->
    <div class="q-pa-sm">
      <q-breadcrumbs class="text-grey" active-color="grey">
        <q-breadcrumbs-el icon="home" class="home-crumb" style="min-height: 22px;" @click="goHome" />
        <q-breadcrumbs-el v-for="(crumb, index) in breadcrumbs" :key="crumb.id" :label="crumb.topic"
          style="min-height: 22px;" @click="navigateToBreadcrumb(index)" />
      </q-breadcrumbs>
    </div>

    <div class="home-divider" />

    <!-- ── Search bar ─────────────────────────────────────────────────────── -->
    <div class="q-px-md q-py-sm">
      <q-input v-model="searchText" outlined dense filled bg-color="grey-2" label-color="grey-8"
        :label="t('desc_labels.search')" debounce="300" clearable>
        <template #append>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <div class="home-divider q-mb-sm" />

    <!-- ── Sub-topic grid ─────────────────────────────────────────────────── -->
    <div v-if="visibleTopics.length" class="row topic-grid q-px-sm q-mb-sm">
      <div v-for="topic in visibleTopics" :key="topic.id" class="topic-box column items-center justify-center q-ma-xs"
        @click="drillInto(topic)">
        <TopicIcon :icon="topic.icon" size="28px" color="secondary" class="q-mb-xs" />
        <div class="topic-box-label ellipsis text-center">{{ topic.topic }}</div>
      </div>
    </div>

    <!-- ── Content list ───────────────────────────────────────────────────── -->

    <!-- First-load spinner -->
    <div v-if="contentStore.loading && contentStore.items.length === 0" class="row justify-center q-pa-xl">
      <q-spinner-dots color="primary" size="40px" />
    </div>

    <!-- Error -->
    <q-banner v-else-if="contentStore.error" class="bg-negative text-white q-mx-md q-mb-sm" rounded dense>
      <template #avatar><q-icon name="error_outline" /></template>
      {{ contentStore.error }}
      <template #action>
        <q-btn flat label="Retry" @click="contentStore.fetchAll()" />
      </template>
    </q-banner>

    <!-- Empty state -->
    <div v-else-if="filteredItems.length === 0 && !contentStore.loading"
      class="column items-center q-pa-xl text-grey-5">
      <q-icon name="search_off" size="3rem" class="q-mb-sm" />
      <div>{{ t('desc_labels.no_results') }}</div>
    </div>

    <!-- Infinite-scroll list -->
    <q-infinite-scroll v-else :offset="200" @load="onLoad">
      <q-list separator>
        <q-item v-for="item in filteredItems" :key="`${item.type}-${item.id}`" clickable v-ripple class="content-row"
          @click="openItem(item)">
          <q-item-section avatar>
            <q-icon :name="TYPE_ICONS[item.type] ?? 'article'" :color="TYPE_COLORS[item.type] ?? 'primary'"
              size="22px" />
          </q-item-section>

          <q-item-section>
            <q-item-label class="content-row-title text-weight-bold">
              {{ item.title }}
            </q-item-label>
            <q-item-label v-if="item.type === 'event' && item.startDate" caption class="text-grey-6">
              {{ formatDate(item.startDate) }}
              <span v-if="item.location"> · {{ item.location }}</span>
            </q-item-label>
            <q-item-label v-else-if="searchText && item.description" caption class="text-grey-6 ellipsis">
              {{ item.description }}
            </q-item-label>
          </q-item-section>

          <!-- TTS placeholder -->
          <q-item-section side>
            <q-btn flat round dense icon="volume_up" size="sm" color="grey-5" @click.stop="" aria-label="Listen" />
          </q-item-section>
        </q-item>
      </q-list>

      <template #loading>
        <div class="row justify-center q-pa-md">
          <q-spinner-dots color="primary" size="32px" />
        </div>
      </template>
    </q-infinite-scroll>

  </q-page>
</template>

<style scoped lang="scss">
.home-page {
  max-width: 540px;
  margin: 0 auto;
}

.home-crumb {
  cursor: pointer;
}

.home-divider {
  background-color: #efefef;
  height: 5px;
}

// ── Topic grid ────────────────────────────────────────────────────────────────

.topic-grid {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.topic-box {
  width: 90px;
  height: 90px;
  border: 0.5px solid $secondary;
  border-radius: 5px;
  background-color: #fafafa;
  cursor: pointer;
  padding: 6px;
  transition: box-shadow 0.15s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
}

.topic-box-label {
  color: $secondary;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  max-width: 82px;
}

// ── Content rows ─────────────────────────────────────────────────────────────

.content-row {
  min-height: 48px;
}

.content-row-title {
  font-size: 13px;
  line-height: 1.3;
}
</style>