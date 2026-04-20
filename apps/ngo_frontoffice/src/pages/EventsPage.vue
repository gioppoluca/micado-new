<template>
    <!--
    EventsPage — /events
    ════════════════════════════════════════════════════════════════════════════

    Layout: two-column (filter sidebar left, list + form right) following
    the exact design from the legacy EventListPage + image references.

    ── Filter sidebar (left) ─────────────────────────────────────────────────
      - Category    (single-select checkboxes, loaded from GET /categories?subtype=event)
      - Topics      (multi-select checkboxes, loaded from GET /topics)
      - User Types  (multi-select checkboxes, loaded from GET /user-types)
      All filters are AND-combined. "Clear all filters" resets everything.

    ── List area (right) ─────────────────────────────────────────────────────
      Header: search input + Add Event + Import Event + Add Categories buttons
      Per-item card:
        Row 1: title
        Row 2: Topics icons | User Type badges | Category label | available translations
        Row 3: description (Markdown, collapsed with read-more)
        Row 4 (expanded): start date, end date, location
        Right column: Published toggle | Translation state | export icon | edit icon

    ── Form (inline, replaces list) ─────────────────────────────────────────
      Fields:
        1. MultiLangEditorTabs (title + RichTextEditor per language — @mentions supported)
        2. Start date + time pickers
        3. End date + time pickers
        4. Category single q-select (loaded from /categories?subtype=event)
        5. TopicTreeSelect (multi)
        6. User Types q-select (multi)
        7. Location text input + Google Maps link
        8. Cost input + "event is free" checkbox
        9. Publish toggle
       10. Send-to-translation toggle (DRAFT ↔ APPROVED)

    ── Pagination ────────────────────────────────────────────────────────────
      Server-side. The store fetches both list + count in parallel.
      QPage component at the bottom of the list.
    -->
    <q-page padding>

        <div class="row q-col-gutter-md">

            <!-- ── Filter sidebar ──────────────────────────────────────────── -->
            <div v-if="!formOpen" class="col-12 col-md-3">
                <q-card flat bordered class="filter-sidebar q-pa-md">
                    <div class="row items-center q-mb-sm">
                        <span class="text-subtitle2 col">{{ t('filters.filter_by') }}</span>
                        <q-btn v-if="hasActiveFilters" flat dense no-caps size="sm" color="accent"
                            :label="t('filters.clear_all')" @click="clearFilters" />
                    </div>

                    <!-- Category filter -->
                    <q-expansion-item :label="t('filters.category_title')" default-opened expand-separator
                        class="q-mb-sm">
                        <template v-for="cat in filterCategories" :key="cat.id">
                            <q-item dense>
                                <q-item-section avatar>
                                    <q-checkbox :model-value="activeFilter.categoryId === cat.id"
                                        @update:model-value="toggleCategoryFilter(cat.id)" dense size="sm" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label>{{ cat.title }}</q-item-label>
                                </q-item-section>
                            </q-item>
                        </template>
                        <q-item v-if="filterCategories.length === 0" dense>
                            <q-item-section>
                                <q-item-label caption class="text-grey-6">
                                    {{ t('data_settings.no_event_categories') }}
                                </q-item-label>
                            </q-item-section>
                        </q-item>
                        <q-item v-if="filterCategories.length > 3" dense class="q-mt-xs">
                            <q-btn flat dense no-caps size="sm" color="accent"
                                :label="showAllCategories ? t('button.show_less') : t('filters.show_more')"
                                @click="showAllCategories = !showAllCategories" />
                        </q-item>
                    </q-expansion-item>

                    <!-- Topics filter -->
                    <q-expansion-item :label="t('filters.topics_title')" default-opened expand-separator
                        class="q-mb-sm">
                        <template v-for="topic in visibleTopics" :key="topic.id">
                            <q-item dense>
                                <q-item-section avatar>
                                    <q-checkbox :model-value="activeFilter.topicIds?.includes(topic.id) ?? false"
                                        @update:model-value="toggleTopicFilter(topic.id)" dense size="sm" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label>{{ topic.topic }}</q-item-label>
                                </q-item-section>
                                <q-item-section v-if="topic.dataExtra?.icon" side>
                                    <q-avatar size="20px">
                                        <img :src="topic.dataExtra.icon" :alt="topic.topic" />
                                    </q-avatar>
                                </q-item-section>
                            </q-item>
                        </template>
                        <q-item v-if="topicStore.topics.length > 3" dense class="q-mt-xs">
                            <q-btn flat dense no-caps size="sm" color="accent"
                                :label="showAllTopics ? t('button.show_less') : t('filters.show_more')"
                                @click="showAllTopics = !showAllTopics" />
                        </q-item>
                    </q-expansion-item>

                    <!-- User Types filter -->
                    <q-expansion-item :label="t('filters.user_types_title')" default-opened expand-separator>
                        <template v-for="ut in visibleUserTypes" :key="ut.id">
                            <q-item dense>
                                <q-item-section avatar>
                                    <q-checkbox :model-value="activeFilter.userTypeIds?.includes(ut.id) ?? false"
                                        @update:model-value="toggleUserTypeFilter(ut.id)" dense size="sm" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label>{{ ut.user_type }}</q-item-label>
                                </q-item-section>
                                <q-item-section side v-if="ut.dataExtra?.icon">
                                    <q-avatar size="20px">
                                        <img :src="ut.dataExtra!.icon" :alt="ut.user_type" />
                                    </q-avatar>
                                </q-item-section>
                            </q-item>
                        </template>
                        <q-item v-if="userTypeStore.userTypes.length > 3" dense class="q-mt-xs">
                            <q-btn flat dense no-caps size="sm" color="accent"
                                :label="showAllUserTypes ? t('button.show_less') : t('filters.show_more')"
                                @click="showAllUserTypes = !showAllUserTypes" />
                        </q-item>
                    </q-expansion-item>
                </q-card>
            </div>

            <!-- ── Main content ────────────────────────────────────────────── -->
            <div :class="formOpen ? 'col-12' : 'col-12 col-md-9'">

                <!-- ── Page header ──────────────────────────────────────────── -->
                <div class="events-header q-mb-md">
                    <div class="row items-center q-gutter-sm">
                        <!-- Title / header image (from image 2) -->
                        <h5 class="col q-my-none">{{ t('menu.events') }}</h5>
                    </div>
                    <div class="row items-center q-gutter-sm q-mt-sm">
                        <q-input v-if="!formOpen" v-model="searchQuery" outlined dense
                            :placeholder="t('input_labels.search')" class="col" style="max-width: 300px">
                            <template #append>
                                <q-icon name="search" />
                            </template>
                        </q-input>
                        <q-space />
                        <q-btn v-if="!formOpen" color="primary" no-caps unelevated :label="t('button.add_event')"
                            @click="openNewForm" />
                        <q-btn v-if="!formOpen" color="primary" no-caps unelevated :label="t('button.import_events')"
                            @click="onImportClick" />
                    </div>
                </div>

                <!-- ── Error banner ─────────────────────────────────────────── -->
                <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
                    <template #avatar><q-icon name="error" /></template>
                    {{ store.error }}
                    <template #action>
                        <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
                    </template>
                </q-banner>

                <!-- ════════════════════════════════════════════════════════════
                     FORM
                     ════════════════════════════════════════════════════════════ -->
                <q-card v-if="formOpen" class="q-pa-md q-mb-lg">
                    <div class="text-h6 q-mb-md">
                        {{ isNew ? t('events.add_new') : t('events.edit') }}
                    </div>

                    <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

                    <template v-if="!formLoading">

                        <!-- 1. MultiLang title + description (with @ mentions) -->
                        <HelpLabel :field-label="t('input_labels.title_description')"
                            :help-label="t('help.element_description')" class="q-mb-xs" />
                        <MultiLangEditorTabs v-model="form.translations" :languages="sortedLanguages" :show-title="true"
                            :title-max-length="255" :readonly="form.status === 'PUBLISHED'"
                            data-cy="event_multilang_tabs" />

                        <!-- 2 & 3. Dates -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.start_date')"
                                    :help-label="t('help.element_start_date')" class="q-mb-xs" />
                                <q-input outlined dense v-model="form.startDate" :readonly="form.status === 'PUBLISHED'"
                                    :label="t('input_labels.start_date')">
                                    <template #prepend><q-icon name="event" /></template>
                                    <q-popup-proxy transition-show="scale" transition-hide="scale">
                                        <q-date v-model="form.startDate" mask="YYYY-MM-DD" />
                                    </q-popup-proxy>
                                </q-input>
                                <q-input outlined dense v-model="form.startTime" class="q-mt-sm"
                                    :readonly="form.status === 'PUBLISHED'" :label="t('input_labels.start_time')">
                                    <template #prepend><q-icon name="access_time" /></template>
                                    <q-popup-proxy transition-show="scale" transition-hide="scale">
                                        <q-time v-model="form.startTime" format24h />
                                    </q-popup-proxy>
                                </q-input>
                            </div>
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.end_date')"
                                    :help-label="t('help.element_start_date')" class="q-mb-xs" />
                                <q-input outlined dense v-model="form.endDate" :readonly="form.status === 'PUBLISHED'"
                                    :label="t('input_labels.end_date')">
                                    <template #prepend><q-icon name="event" /></template>
                                    <q-popup-proxy transition-show="scale" transition-hide="scale">
                                        <q-date v-model="form.endDate" mask="YYYY-MM-DD" />
                                    </q-popup-proxy>
                                </q-input>
                                <q-input outlined dense v-model="form.endTime" class="q-mt-sm"
                                    :readonly="form.status === 'PUBLISHED'" :label="t('input_labels.end_time')">
                                    <template #prepend><q-icon name="access_time" /></template>
                                    <q-popup-proxy transition-show="scale" transition-hide="scale">
                                        <q-time v-model="form.endTime" format24h />
                                    </q-popup-proxy>
                                </q-input>
                            </div>
                        </div>

                        <!-- 4. Category -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_category')"
                                    :help-label="t('help.element_category')" class="q-mb-xs" />
                                <q-select v-model="form.categoryId" :options="categoryOptions" option-value="id"
                                    option-label="title" emit-value map-options clearable outlined dense
                                    :disable="form.status === 'PUBLISHED'" :label="t('input_labels.select_category')"
                                    data-cy="category_select" />
                            </div>

                            <!-- 7. Location -->
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.location')" :help-label="t('help.location')"
                                    class="q-mb-xs" />
                                <q-input v-model="form.location" outlined dense :readonly="form.status === 'PUBLISHED'"
                                    :label="t('input_labels.location')" data-cy="location_input">
                                    <template #append>
                                        <a v-if="form.location"
                                            :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.location)}`"
                                            target="_blank" rel="noopener noreferrer">
                                            <q-icon name="place" color="accent" />
                                        </a>
                                        <q-icon v-else name="place" color="grey-4" />
                                    </template>
                                </q-input>
                            </div>
                        </div>

                        <!-- 5. Topics -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_topics')"
                                    :help-label="t('help.element_topics')" class="q-mb-xs" />
                                <TopicTreeSelect v-model="form.topicId" :topics="topicStore.topics"
                                    :max-selectable-depth="99" data-cy="topics_select" />
                                <!-- Multi-topic: show chips for selected + allow multi-add -->
                                <div class="q-mt-xs row q-gutter-xs">
                                    <q-chip v-for="tid in form.topicIds" :key="tid" removable dense color="grey-3"
                                        text-color="grey-8" @remove="removeTopicId(tid)">
                                        {{ topicLabel(tid) }}
                                    </q-chip>
                                </div>
                            </div>

                            <!-- 6. User Types -->
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_user_type')"
                                    :help-label="t('help.element_user_type')" class="q-mb-xs" />
                                <q-select v-model="form.userTypeIds" :options="userTypeOptions" option-value="id"
                                    option-label="user_type" emit-value map-options multiple use-chips outlined dense
                                    :disable="form.status === 'PUBLISHED'" :label="t('input_labels.select_user_type')"
                                    data-cy="user_types_select" />
                            </div>
                        </div>

                        <!-- 8. Cost -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.event_cost')"
                                    :help-label="t('help.event_cost')" class="q-mb-xs" />
                                <div class="row items-center q-gutter-md">
                                    <q-input v-model="form.cost" outlined dense class="col"
                                        :disable="form.isFree || form.status === 'PUBLISHED'"
                                        :label="t('input_labels.event_cost')" data-cy="cost_input" />
                                    <q-checkbox v-model="form.isFree" :disable="form.status === 'PUBLISHED'"
                                        :label="t('input_labels.event_is_free')" data-cy="is_free_checkbox" />
                                </div>
                            </div>

                            <!-- 9. Publish + 10. Send to translation -->
                            <div class="col-12 col-sm-6">
                                <div class="row items-center justify-between q-mt-sm">
                                    <span class="text-body2">{{ t('input_labels.validate_publish') }}</span>
                                    <q-toggle :model-value="form.status === 'PUBLISHED'"
                                        :disable="form.status === 'APPROVED'" color="accent"
                                        @update:model-value="onPublishToggle" />
                                </div>
                                <div class="row items-center justify-between q-mt-sm">
                                    <span class="text-body2">{{ t('translation_states.translatable') }}</span>
                                    <q-toggle :model-value="form.status === 'APPROVED'"
                                        :disable="form.status === 'PUBLISHED'" color="accent"
                                        @update:model-value="v => form.status = v ? 'APPROVED' : 'DRAFT'" />
                                </div>
                            </div>
                        </div>

                        <!-- Form actions -->
                        <div class="row q-gutter-sm q-mt-lg">
                            <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.cancel')"
                                @click="closeForm" />
                            <q-space />
                            <q-btn class="save_button" no-caps color="accent" unelevated rounded
                                :label="t('button.save')" :loading="store.loading" @click="onSave" />
                        </div>
                    </template>
                </q-card>

                <!-- ════════════════════════════════════════════════════════════
                     LIST
                     ════════════════════════════════════════════════════════════ -->
                <template v-if="!formOpen">

                    <!-- Column headers row -->
                    <div class="row items-center q-px-md q-mb-xs text-caption text-grey-7">
                        <div class="col">{{ t('input_labels.title_description') }}</div>
                        <div class="col-1 text-center">{{ t('lists.published') }}</div>
                        <div class="col-2 text-center">{{ t('lists.translation_state') }}</div>
                        <div class="col-1 text-center">{{ t('input_labels.export') }}</div>
                        <div class="col-1 text-center">{{ t('lists.edit') }}</div>
                    </div>

                    <q-inner-loading :showing="store.loading" />

                    <q-list bordered separator>
                        <q-item v-for="event in filteredBySearch" :key="event.id" class="q-py-md event-list-item">
                            <!-- ── Left: content ──────────────────────────── -->
                            <q-item-section class="col">

                                <!-- Title -->
                                <q-item-label class="text-subtitle2 text-weight-medium q-mb-xs">
                                    {{ event.title }}
                                </q-item-label>

                                <!-- Tags row: topics | user types | category | translations -->
                                <div class="row items-center q-gutter-x-sm q-mb-sm flex-wrap">

                                    <!-- Topic icons -->
                                    <span v-if="event.topicIds.length" class="tags_text row items-center q-gutter-x-xs">
                                        <q-avatar v-for="tid in event.topicIds" :key="tid" size="24px"
                                            class="topic-icon" :title="topicLabel(tid)">
                                            <img v-if="topicIcon(tid)" :src="topicIcon(tid)" :alt="topicLabel(tid)" />
                                            <q-icon v-else name="category" size="xs" />
                                        </q-avatar>
                                    </span>

                                    <!-- User type badges -->
                                    <span v-if="event.userTypeIds.length"
                                        class="tags_text row items-center q-gutter-x-xs">
                                        <q-avatar v-for="uid in event.userTypeIds" :key="uid" size="24px"
                                            class="usertype-icon" :title="userTypeLabel(uid)">
                                            <img v-if="userTypeIconById(uid)" :src="userTypeIconById(uid)"
                                                :alt="userTypeLabel(uid)" />
                                            <q-icon v-else name="person" size="xs" />
                                        </q-avatar>
                                    </span>

                                    <!-- Category -->
                                    <span v-if="event.categoryTitle" class="tags_text text-caption">
                                        {{ t('lists.category') }}: <strong>{{ event.categoryTitle }}</strong>
                                    </span>

                                    <!-- Available translations -->
                                    <span class="tags_text text-caption">
                                        {{ t('input_labels.available_transl') }}:
                                    </span>
                                    <q-chip v-for="lang in eventTranslationLangs(event)" :key="lang" dense size="xs"
                                        color="teal-1" text-color="teal-9">
                                        {{ lang }}
                                    </q-chip>
                                </div>

                                <!-- Description preview (Markdown) -->
                                <RichTextViewer :content="event.description ?? ''"
                                    :all-entities-fetched="entitiesStore.allEntitiesFetched" :read-more="true"
                                    class="q-mb-xs event-description-preview" />

                                <!-- Expanded: dates + location -->
                                <div v-if="expandedIds.has(event.id)" class="q-mt-sm text-caption text-grey-7">
                                    <div v-if="event.dataExtra?.startDate || event.dataExtra?.endDate">
                                        <q-icon name="event" size="xs" class="q-mr-xs" />
                                        {{ t('lists.start_date') }}: {{ formatDate(event.dataExtra?.startDate) }}
                                        <span v-if="event.dataExtra?.endDate">
                                            — {{ t('lists.end_date') }}: {{ formatDate(event.dataExtra.endDate) }}
                                        </span>
                                    </div>
                                    <div v-if="event.dataExtra?.location" class="q-mt-xs">
                                        <q-icon name="place" size="xs" class="q-mr-xs" />
                                        {{ event.dataExtra.location }}
                                    </div>
                                </div>

                                <!-- Read more / less toggle -->
                                <q-btn flat dense no-caps size="sm"
                                    :label="expandedIds.has(event.id) ? t('lists.read_less') : t('lists.read_more')"
                                    class="self-start q-mt-xs" @click="toggleExpanded(event.id)" />
                            </q-item-section>

                            <!-- ── Right: controls ────────────────────────── -->
                            <q-item-section side class="col-auto">
                                <div class="column items-center q-gutter-y-sm" style="min-width: 160px">

                                    <!-- Published toggle -->
                                    <q-toggle :model-value="event.status === 'PUBLISHED'"
                                        :disable="event.status === 'DRAFT'" color="accent" size="sm"
                                        @update:model-value="onPublishedToggle($event, event)" />

                                    <!-- Translation state -->
                                    <q-badge :color="statusColor(event.status)" :label="t(eventStatusKey(event))"
                                        class="q-mb-xs" />

                                    <!-- Actions -->
                                    <div class="row q-gutter-xs">
                                        <q-btn flat round icon="download" size="sm" color="grey-6"
                                            :data-cy="`export_event_${event.id}`" @click="onExport(event)">
                                            <q-tooltip>{{ t('input_labels.export') }}</q-tooltip>
                                        </q-btn>
                                        <q-btn flat round icon="edit" size="sm" color="orange"
                                            :data-cy="`edit_event_${event.id}`" @click="onEditRowClick(event)">
                                            <q-tooltip>{{ t('button.edit') }}</q-tooltip>
                                        </q-btn>
                                    </div>
                                </div>
                            </q-item-section>
                        </q-item>

                        <!-- Empty state -->
                        <q-item v-if="!store.loading && filteredBySearch.length === 0">
                            <q-item-section class="text-grey-6 text-caption q-py-lg text-center">
                                {{ hasActiveFilters || searchQuery
                                    ? t('events.no_results')
                                    : t('events.empty') }}
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <!-- ── Pagination ──────────────────────────────────────── -->
                    <div v-if="store.totalCount > pageSize" class="row justify-center q-mt-md">
                        <q-pagination v-model="currentPage" :max="totalPages" boundary-numbers color="accent"
                            @update:model-value="onPageChange" />
                    </div>

                </template>
            </div>
        </div>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useEventStore } from 'src/stores/event-store';
import { useCategoryStore } from 'src/stores/category-store';
import { useTopicStore } from 'src/stores/topic-store';
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { useMicadoEntitiesStore } from 'src/stores/micado-entities-store';
import { eventStatusKey } from 'src/api/event.api';
import type { Event, EventFull, EventListFilter, RevisionSummary } from 'src/api/event.api';
import HelpLabel from 'src/components/HelpLabel.vue';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import RichTextViewer from 'src/components/rich-text-editor/RichTextViewer.vue';
import TopicTreeSelect from 'src/components/settings/TopicTreeSelect.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useEventStore();
const categoryStore = useCategoryStore();
const topicStore = useTopicStore();
const userTypeStore = useUserTypeStore();
const langStore = useLanguageStore();
const app = useAppStore();
const entitiesStore = useMicadoEntitiesStore();

// ─── Filter sidebar state ─────────────────────────────────────────────────────

const activeFilter = ref<EventListFilter>({ page: 1, pageSize: 20 });
const showAllCategories = ref(false);
const showAllTopics = ref(false);
const showAllUserTypes = ref(false);
const searchQuery = ref('');

const pageSize = computed(() => activeFilter.value.pageSize ?? 20);
const currentPage = ref(1);
const totalPages = computed(() => Math.ceil(store.totalCount / pageSize.value));

const filterCategories = computed(() => {
    const cats = categoryStore.categories;
    return showAllCategories.value ? cats : cats.slice(0, 3);
});
const visibleTopics = computed(() => {
    const topics = topicStore.topics;
    return showAllTopics.value ? topics : topics.slice(0, 3);
});
const visibleUserTypes = computed(() => {
    const uts = userTypeStore.userTypes;
    return showAllUserTypes.value ? uts : uts.slice(0, 3);
});

const hasActiveFilters = computed(() =>
    activeFilter.value.categoryId != null ||
    (activeFilter.value.topicIds?.length ?? 0) > 0 ||
    (activeFilter.value.userTypeIds?.length ?? 0) > 0,
);

const filteredBySearch = computed(() => {
    const q = searchQuery.value.toLowerCase().trim();
    if (!q) return store.events;
    return store.events.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q),
    );
});

function toggleCategoryFilter(id: number): void {
    const next = activeFilter.value.categoryId === id ? null : id;
    // exactOptionalPropertyTypes: use conditional spread — null clears, number sets
    activeFilter.value = {
        ...activeFilter.value,
        page: 1,
        ...(next === null ? { categoryId: null } : { categoryId: next }),
    };
    currentPage.value = 1;
    void store.fetchAll(activeFilter.value);
}

function toggleTopicFilter(id: number): void {
    const current = activeFilter.value.topicIds ?? [];
    const next = current.includes(id) ? current.filter(t => t !== id) : [...current, id];
    // exactOptionalPropertyTypes: when empty, omit the key entirely (cannot set undefined)
    if (next.length) {
        activeFilter.value = { ...activeFilter.value, topicIds: next, page: 1 };
    } else {
        activeFilter.value = omitFilterKey(activeFilter.value, 'topicIds');
    }
    currentPage.value = 1;
    void store.fetchAll(activeFilter.value);
}

function toggleUserTypeFilter(id: number): void {
    const current = activeFilter.value.userTypeIds ?? [];
    const next = current.includes(id) ? current.filter(u => u !== id) : [...current, id];
    // exactOptionalPropertyTypes: when empty, omit the key entirely
    if (next.length) {
        activeFilter.value = { ...activeFilter.value, userTypeIds: next, page: 1 };
    } else {
        activeFilter.value = omitFilterKey(activeFilter.value, 'userTypeIds');
    }
    currentPage.value = 1;
    void store.fetchAll(activeFilter.value);
}

function clearFilters(): void {
    activeFilter.value = { page: 1, pageSize: pageSize.value };
    currentPage.value = 1;
    searchQuery.value = '';
    void store.fetchAll(activeFilter.value);
}

function onPageChange(page: number): void {
    activeFilter.value = { ...activeFilter.value, page };
    void store.fetchAll(activeFilter.value);
}

/**
 * Returns a new filter object without the specified key.
 * Used to satisfy exactOptionalPropertyTypes — setting a key to `undefined`
 * is not allowed; we must omit it entirely.
 */
function omitFilterKey(
    filter: EventListFilter,
    key: keyof EventListFilter,
): EventListFilter {
    const copy = { ...filter, page: 1 } as Record<string, unknown>;
    delete copy[key];
    return copy as EventListFilter;
}

// ─── Expanded list items (dates + location) ───────────────────────────────────

const expandedIds = ref(new Set<number>());

function toggleExpanded(id: number): void {
    if (expandedIds.value.has(id)) {
        expandedIds.value.delete(id);
    } else {
        expandedIds.value.add(id);
    }
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
    id: number;
    status: Event['status'];
    sourceLang: string;
    translations: Record<string, { title?: string; description: string }>;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    location: string;
    cost: string;
    isFree: boolean;
    categoryId: number | null;
    topicId: number | null;       // bound to TreeSelect (single pick + add)
    topicIds: number[];           // accumulated multi-select
    userTypeIds: number[];
    revisions: RevisionSummary[];
}

const formOpen = ref(false);
const formLoading = ref(false);
const isNew = ref(false);

function blankForm(): FormState {
    const src = app.defaultLang || 'it';
    return {
        id: -1,
        status: 'DRAFT',
        sourceLang: src,
        translations: { [src]: { title: '', description: '' } },
        startDate: '',
        startTime: '',
        endDate: '',
        endTime: '',
        location: '',
        cost: '',
        isFree: true,
        categoryId: null,
        topicId: null,
        topicIds: [],
        userTypeIds: [],
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());

// Add topic from TreeSelect to topicIds[]
watch(() => form.value.topicId, (id) => {
    if (id !== null && !form.value.topicIds.includes(id)) {
        form.value.topicIds.push(id);
    }
    form.value.topicId = null; // reset picker
});

function removeTopicId(id: number): void {
    form.value.topicIds = form.value.topicIds.filter(t => t !== id);
}

const sortedLanguages = computed(() => {
    const src = form.value.sourceLang;
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

const categoryOptions = computed(() => categoryStore.categories);
const userTypeOptions = computed(() => userTypeStore.userTypes);

// ─── Form lifecycle ───────────────────────────────────────────────────────────

function openNewForm(): void {
    form.value = blankForm();
    for (const l of langStore.activeLanguages) {
        if (!form.value.translations[l.lang]) {
            form.value.translations[l.lang] = { title: '', description: '' };
        }
    }
    isNew.value = true;
    formOpen.value = true;
}

async function openEditForm(event: Event): Promise<void> {
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    // Optimistic skeleton from flat record
    form.value = {
        ...blankForm(),
        id: event.id,
        status: event.status,
        sourceLang: event.sourceLang,
        startDate: extractDate(event.dataExtra?.startDate),
        startTime: extractTime(event.dataExtra?.startDate),
        endDate: extractDate(event.dataExtra?.endDate),
        endTime: extractTime(event.dataExtra?.endDate),
        location: event.dataExtra?.location ?? '',
        cost: event.dataExtra?.cost ?? '',
        isFree: event.dataExtra?.isFree ?? true,
        categoryId: event.categoryId,
        topicId: null,
        topicIds: [...event.topicIds],
        userTypeIds: [...event.userTypeIds],
        translations: { [event.sourceLang]: { title: event.title, description: event.description ?? '' } },
        revisions: [],
    };

    const full = await store.getOne(event.id);
    formLoading.value = false;
    if (!full) return;

    form.value.status = full.status ?? event.status;
    form.value.sourceLang = full.sourceLang ?? event.sourceLang;
    form.value.revisions = full.revisions ?? [];
    form.value.categoryId = full.categoryId ?? event.categoryId;
    form.value.topicIds = full.topicIds ? [...full.topicIds] : [...event.topicIds];
    form.value.userTypeIds = full.userTypeIds ? [...full.userTypeIds] : [...event.userTypeIds];
    form.value.startDate = extractDate(full.dataExtra?.startDate ?? event.dataExtra?.startDate);
    form.value.startTime = extractTime(full.dataExtra?.startDate ?? event.dataExtra?.startDate);
    form.value.endDate = extractDate(full.dataExtra?.endDate ?? event.dataExtra?.endDate);
    form.value.endTime = extractTime(full.dataExtra?.endDate ?? event.dataExtra?.endDate);
    form.value.location = full.dataExtra?.location ?? event.dataExtra?.location ?? '';
    form.value.cost = full.dataExtra?.cost ?? '';
    form.value.isFree = full.dataExtra?.isFree ?? true;

    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description ?? '' };
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: event.title, description: event.description ?? '' };
    }
    for (const l of langStore.activeLanguages) {
        if (!tabs[l.lang]) tabs[l.lang] = { title: '', description: '' };
    }
    form.value.translations = tabs;
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
}

// ─── Publish toggles ──────────────────────────────────────────────────────────

function onPublishToggle(newValue: boolean): void {
    if (form.value.status === 'APPROVED') return;
    if (newValue) form.value.status = 'PUBLISHED';
    else form.value.status = 'DRAFT';
}

function onPublishedToggle(newValue: boolean, event: Event): void {
    if (newValue) void store.publish(event.id);
    else void store.unpublish(event.id);
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function onEditRowClick(event: Event): void {
    void openEditForm(event);
}

function onExport(event: Event): void {
    logger.info('[EventsPage] export', { id: event.id });
    $q.notify({ type: 'info', message: `Export for event ${event.id} — not yet implemented` });
}

function onImportClick(): void {
    $q.notify({ type: 'info', message: t('events.import_not_implemented') });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    const srcLang = form.value.sourceLang;
    const srcTitle = (form.value.translations[srcLang]?.title ?? '').trim();

    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }
    if (!form.value.startDate || !form.value.endDate) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const startDate = buildIso(form.value.startDate, form.value.startTime);
    const endDate = buildIso(form.value.endDate, form.value.endTime);

    const translationsMap: Record<string, { title: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(form.value.translations)) {
        const title = (entry.title ?? '').trim();
        if (lang === srcLang || title) {
            translationsMap[lang] = { title, description: entry.description ?? '' };
        }
    }

    const locationTrimmed = form.value.location.trim();
    const payload: EventFull = {
        status: form.value.status,
        sourceLang: srcLang,
        dataExtra: {
            startDate,
            endDate,
            isFree: form.value.isFree,
            cost: form.value.isFree ? null : (form.value.cost.trim() || null),
            ...(locationTrimmed && { location: locationTrimmed }),
        },
        categoryId: form.value.categoryId,
        topicIds: [...form.value.topicIds],
        userTypeIds: [...form.value.userTypeIds],
        translations: translationsMap,
    };

    if (isNew.value) {
        const created = await store.create(payload);
        if (!created || store.error) return;
    } else {
        payload.id = form.value.id;
        const ok = await store.save(form.value.id, payload);
        if (!ok || store.error) return;
    }

    closeForm();
}

// ─── Helpers: display ────────────────────────────────────────────────────────

function topicLabel(id: number): string {
    return topicStore.topics.find(t => t.id === id)?.topic ?? String(id);
}

function topicIcon(id: number): string {
    return topicStore.topics.find(t => t.id === id)?.dataExtra?.icon ?? '';
}

function userTypeLabel(id: number): string {
    return userTypeStore.userTypes.find(u => u.id === id)?.user_type ?? String(id);
}

function userTypeIconById(id: number): string {
    return userTypeStore.userTypes.find(u => u.id === id)?.dataExtra?.icon ?? '';
}

function eventTranslationLangs(event: Event): string[] {
    // Available translations shown in list — from the full record if cached, else just sourceLang
    return [event.sourceLang];
}

function statusColor(status: Event['status']): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'APPROVED' ? 'orange'
            : status === 'ARCHIVED' ? 'grey'
                : 'blue-grey';
}

function formatDate(iso?: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
}

function extractDate(iso?: string): string {
    if (!iso) return '';
    return iso.slice(0, 10); // YYYY-MM-DD
}

function extractTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildIso(date: string, time: string): string {
    if (!date) return '';
    const t = time || '00:00';
    return new Date(`${date}T${t}:00`).toISOString();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    await Promise.all([
        store.fetchAll(activeFilter.value),
        categoryStore.categories.length === 0
            ? categoryStore.fetchAll('event')
            : Promise.resolve(),
        topicStore.topics.length === 0
            ? topicStore.fetchAll()
            : Promise.resolve(),
        userTypeStore.userTypes.length === 0
            ? userTypeStore.fetchAll()
            : Promise.resolve(),
        langStore.languages.length === 0
            ? langStore.fetchAll()
            : Promise.resolve(),
    ]);
});
</script>

<style scoped lang="scss">
.filter-sidebar {
    position: sticky;
    top: 16px;
}

.event-list-item {
    align-items: flex-start;
}

.event-description-preview {
    max-height: 80px;
    overflow: hidden;
}

.tags_text {
    font-size: 12px;
    color: #666;
}

.topic-icon,
.usertype-icon {
    border: 1px solid #e0e0e0;
    border-radius: 50%;
    background: white;
}

.cancel_button {
    background: white;
    color: black;
    border: 1px solid #c71f40;
    min-width: 100px;
    border-radius: 5px;
}

.save_button {
    min-width: 100px;
    border-radius: 5px;
}
</style>