<template>
    <!--
    InformationPage — /information
    ════════════════════════════════════════════════════════════════════════════

    Useful Information Centre. Same layout as EventsPage with two-column
    filter sidebar + list, but the form is simpler:
    no date pickers, no location, no cost/isFree fields.

    ── Form fields ──────────────────────────────────────────────────────────
      1. MultiLangEditorTabs (title + RichTextEditor with @ mentions)
      2. Category single q-select (from GET /categories?subtype=information)
      3. TopicTreeSelect (multi, accumulated into topicIds[])
      4. User Types q-select (multi)
      5. Send-to-translation toggle (DRAFT ↔ APPROVED)
      6. Publish toggle

    ── Filter sidebar ────────────────────────────────────────────────────────
      Category / Topics / User Types — AND-combined, dynamically loaded.

    ── Pagination ────────────────────────────────────────────────────────────
      Server-side via q-pagination.
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
                        <template v-for="cat in visibleCategories" :key="cat.id">
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
                        <q-item v-if="categoryStore.categories.length === 0" dense>
                            <q-item-section>
                                <q-item-label caption class="text-grey-6">
                                    {{ t('data_settings.no_event_categories') }}
                                </q-item-label>
                            </q-item-section>
                        </q-item>
                        <q-item v-if="categoryStore.categories.length > 3" dense class="q-mt-xs">
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
                                <q-item-section v-if="ut.dataExtra?.icon" side>
                                    <q-avatar size="20px">
                                        <img :src="ut.dataExtra.icon" :alt="ut.user_type" />
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

                <!-- ── Page header ─────────────────────────────────────────── -->
                <div class="q-mb-md">
                    <div class="row items-center q-gutter-sm q-mt-sm">
                        <q-input v-if="!formOpen" v-model="searchQuery" outlined dense
                            :placeholder="t('input_labels.search')" class="col" style="max-width: 300px">
                            <template #append><q-icon name="search" /></template>
                        </q-input>
                        <q-space />
                        <q-btn v-if="!formOpen" color="primary" no-caps unelevated :label="t('button.add_information')"
                            @click="openNewForm" />
                        <q-btn v-if="!formOpen" color="primary" no-caps unelevated :label="t('button.categories')"
                            @click="$router.push('/data_settings/information_categories')" />
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
                        {{ isNew ? t('information_centre.add_new') : t('information_centre.edit') }}
                    </div>

                    <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

                    <template v-if="!formLoading">

                        <!-- 1. Title + description per language (with @ mentions) -->
                        <HelpLabel :field-label="t('input_labels.title_description')"
                            :help-label="t('help.element_description')" class="q-mb-xs" />
                        <MultiLangEditorTabs v-model="form.translations" :languages="sortedLanguages" :show-title="true"
                            :title-max-length="255" :readonly="form.status === 'PUBLISHED'"
                            data-cy="information_multilang_tabs" />

                        <!-- 2. Category + Topics -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_category')"
                                    :help-label="t('help.element_category')" class="q-mb-xs" />
                                <q-select v-model="form.categoryId" :options="categoryOptions" option-value="id"
                                    option-label="title" emit-value map-options clearable outlined dense
                                    :disable="form.status === 'PUBLISHED'" :label="t('input_labels.select_category')"
                                    data-cy="category_select" />
                            </div>

                            <!-- User Types -->
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_user_type')"
                                    :help-label="t('help.element_user_type')" class="q-mb-xs" />
                                <q-select v-model="form.userTypeIds" :options="userTypeOptions" option-value="id"
                                    option-label="user_type" emit-value map-options multiple use-chips outlined dense
                                    :disable="form.status === 'PUBLISHED'" :label="t('input_labels.select_user_type')"
                                    data-cy="user_types_select" />
                            </div>
                        </div>

                        <!-- 3. Topics (multi, accumulated via TreeSelect) -->
                        <div class="row q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.select_topics')"
                                    :help-label="t('help.element_topics')" class="q-mb-xs" />
                                <TopicTreeSelect v-model="form.topicId" :topics="topicStore.topics"
                                    :max-selectable-depth="99" data-cy="topics_select" />
                                <div class="q-mt-xs row q-gutter-xs">
                                    <q-chip v-for="tid in form.topicIds" :key="tid" removable dense color="grey-3"
                                        text-color="grey-8" @remove="removeTopicId(tid)">
                                        {{ topicLabel(tid) }}
                                    </q-chip>
                                </div>
                            </div>

                            <!-- Send-to-translation + Publish -->
                            <div class="col-12 col-sm-6 q-pl-md">
                                <div class="row items-center justify-between q-mt-sm">
                                    <span class="text-body2">
                                        {{ t('translation_states.translatable') }}
                                    </span>
                                    <q-toggle :model-value="form.status === 'APPROVED'"
                                        :disable="form.status === 'PUBLISHED'" color="accent"
                                        @update:model-value="v => form.status = v ? 'APPROVED' : 'DRAFT'" />
                                </div>
                                <div class="row items-center justify-between q-mt-sm">
                                    <span class="text-body2">
                                        {{ t('input_labels.validate_publish') }}
                                    </span>
                                    <q-toggle :model-value="form.status === 'PUBLISHED'"
                                        :disable="form.status === 'APPROVED'" color="accent"
                                        @update:model-value="onPublishToggle" />
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

                    <!-- Column headers -->
                    <div class="row items-center q-px-md q-mb-xs text-caption text-grey-7">
                        <div class="col">{{ t('input_labels.title_description') }}</div>
                        <div class="col-1 text-center">{{ t('lists.published') }}</div>
                        <div class="col-2 text-center">{{ t('lists.translation_state') }}</div>
                        <div class="col-1 text-center">{{ t('input_labels.export') }}</div>
                        <div class="col-1 text-center">{{ t('lists.edit') }}</div>
                    </div>

                    <q-inner-loading :showing="store.loading" />

                    <q-list bordered separator>
                        <q-item v-for="item in filteredBySearch" :key="item.id" class="q-py-md information-list-item">
                            <!-- Left: content -->
                            <q-item-section class="col">

                                <!-- Title -->
                                <q-item-label class="text-subtitle2 text-weight-medium q-mb-xs">
                                    {{ item.title }}
                                </q-item-label>

                                <!-- Tags row -->
                                <div class="row items-center q-gutter-x-sm q-mb-sm flex-wrap">

                                    <!-- Topic icons -->
                                    <span v-if="item.topicIds.length" class="tags_text row items-center q-gutter-x-xs">
                                        <q-avatar v-for="tid in item.topicIds" :key="tid" size="24px" class="topic-icon"
                                            :title="topicLabel(tid)">
                                            <img v-if="topicIcon(tid)" :src="topicIcon(tid)" :alt="topicLabel(tid)" />
                                            <q-icon v-else name="category" size="xs" />
                                        </q-avatar>
                                    </span>

                                    <!-- User type avatars -->
                                    <span v-if="item.userTypeIds.length"
                                        class="tags_text row items-center q-gutter-x-xs">
                                        <q-avatar v-for="uid in item.userTypeIds" :key="uid" size="24px"
                                            class="usertype-icon" :title="userTypeLabel(uid)">
                                            <img v-if="userTypeIconById(uid)" :src="userTypeIconById(uid)"
                                                :alt="userTypeLabel(uid)" />
                                            <q-icon v-else name="person" size="xs" />
                                        </q-avatar>
                                    </span>

                                    <!-- Category label -->
                                    <span v-if="item.categoryTitle" class="tags_text text-caption">
                                        {{ t('lists.category') }}:
                                        <strong>{{ item.categoryTitle }}</strong>
                                    </span>

                                    <!-- Available translations chip -->
                                    <span class="tags_text text-caption">
                                        {{ t('input_labels.available_transl') }}:
                                    </span>
                                    <q-chip dense size="xs" color="teal-1" text-color="teal-9">
                                        {{ item.sourceLang }}
                                    </q-chip>
                                </div>

                                <!-- Description preview (Markdown, read-more) -->
                                <RichTextViewer :content="item.description"
                                    :all-entities-fetched="entitiesStore.allEntitiesFetched" :read-more="true"
                                    class="q-mb-xs" />
                            </q-item-section>

                            <!-- Right: controls -->
                            <q-item-section side class="col-auto">
                                <div class="column items-center q-gutter-y-sm" style="min-width: 160px">

                                    <!-- Published toggle -->
                                    <q-toggle :model-value="item.status === 'PUBLISHED'"
                                        :disable="item.status === 'DRAFT'" color="accent" size="sm"
                                        @update:model-value="onPublishedToggle($event, item)" />

                                    <!-- Translation state badge -->
                                    <q-badge :color="statusColor(item.status)" :label="t(informationStatusKey(item))"
                                        class="q-mb-xs" />

                                    <!-- Actions -->
                                    <div class="row q-gutter-xs">
                                        <q-btn flat round icon="download" size="sm" color="grey-6"
                                            :data-cy="`export_information_${item.id}`" @click="onExport(item)">
                                            <q-tooltip>{{ t('input_labels.export') }}</q-tooltip>
                                        </q-btn>
                                        <q-btn flat round icon="edit" size="sm" color="orange"
                                            :data-cy="`edit_information_${item.id}`" @click="onEditRowClick(item)">
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
                                    ? t('information_centre.no_results')
                                    : t('information_centre.empty') }}
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <!-- Pagination -->
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
import { useInformationStore } from 'src/stores/information-store';
import { useCategoryStore } from 'src/stores/category-store';
import { useTopicStore } from 'src/stores/topic-store';
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { useMicadoEntitiesStore } from 'src/stores/micado-entities-store';
import { informationStatusKey } from 'src/api/information.api';
import type {
    Information,
    InformationFull,
    InformationListFilter,
    InformationStatus,
    RevisionSummary,
} from 'src/api/information.api';
import HelpLabel from 'src/components/HelpLabel.vue';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import RichTextViewer from 'src/components/rich-text-editor/RichTextViewer.vue';
import TopicTreeSelect from 'src/components/settings/TopicTreeSelect.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useInformationStore();
const categoryStore = useCategoryStore();
const topicStore = useTopicStore();
const userTypeStore = useUserTypeStore();
const langStore = useLanguageStore();
const app = useAppStore();
const entitiesStore = useMicadoEntitiesStore();

// ─── Filter sidebar ───────────────────────────────────────────────────────────

const activeFilter = ref<InformationListFilter>({ page: 1, pageSize: 20 });
const showAllCategories = ref(false);
const showAllTopics = ref(false);
const showAllUserTypes = ref(false);
const searchQuery = ref('');

const pageSize = computed(() => activeFilter.value.pageSize ?? 20);
const currentPage = ref(1);
const totalPages = computed(() => Math.ceil(store.totalCount / pageSize.value));

const visibleCategories = computed(() => {
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
    if (!q) return store.items;
    return store.items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q),
    );
});

function toggleCategoryFilter(id: number): void {
    const next = activeFilter.value.categoryId === id ? null : id;
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
 * Satisfies exactOptionalPropertyTypes — omit key instead of setting undefined.
 */
function omitFilterKey(
    filter: InformationListFilter,
    key: keyof InformationListFilter,
): InformationListFilter {
    const copy = { ...filter, page: 1 } as Record<string, unknown>;
    delete copy[key];
    return copy as InformationListFilter;
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
    id: number;
    status: InformationStatus;
    sourceLang: string;
    translations: Record<string, { title?: string; description: string }>;
    categoryId: number | null;
    topicId: number | null;    // bound to TreeSelect picker (single)
    topicIds: number[];        // accumulated multi-selection
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
        categoryId: null,
        topicId: null,
        topicIds: [],
        userTypeIds: [],
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());

// Accumulate TreeSelect picks into topicIds[]
watch(() => form.value.topicId, (id) => {
    if (id !== null && !form.value.topicIds.includes(id)) {
        form.value.topicIds.push(id);
    }
    form.value.topicId = null;
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

async function openEditForm(item: Information): Promise<void> {
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    form.value = {
        ...blankForm(),
        id: item.id,
        status: item.status,
        sourceLang: item.sourceLang,
        categoryId: item.categoryId,
        topicId: null,
        topicIds: [...item.topicIds],
        userTypeIds: [...item.userTypeIds],
        translations: {
            [item.sourceLang]: { title: item.title, description: item.description },
        },
        revisions: [],
    };

    const full = await store.getOne(item.id);
    formLoading.value = false;
    if (!full) return;

    form.value.status = full.status ?? item.status;
    form.value.sourceLang = full.sourceLang ?? item.sourceLang;
    form.value.revisions = full.revisions ?? [];
    form.value.categoryId = full.categoryId ?? item.categoryId;
    form.value.topicIds = full.topicIds ? [...full.topicIds] : [...item.topicIds];
    form.value.userTypeIds = full.userTypeIds ? [...full.userTypeIds] : [...item.userTypeIds];

    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description ?? '' };
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: item.title, description: item.description };
    }
    for (const l of langStore.activeLanguages) {
        if (!tabs[l.lang]) tabs[l.lang] = { title: '', description: '' };
    }
    form.value.translations = tabs;
    logger.info('[InformationPage] form loaded', { id: item.id, langs: Object.keys(tabs) });
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
}

// ─── Publish toggles ──────────────────────────────────────────────────────────

function onPublishToggle(newValue: boolean): void {
    if (form.value.status === 'APPROVED') return;
    form.value.status = newValue ? 'PUBLISHED' : 'DRAFT';
}

function onPublishedToggle(newValue: boolean, item: Information): void {
    if (newValue) void store.publish(item.id);
    else void store.unpublish(item.id);
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function onEditRowClick(item: Information): void {
    void openEditForm(item);
}

function onExport(item: Information): void {
    logger.info('[InformationPage] export', { id: item.id });
    $q.notify({ type: 'info', message: `Export for information ${item.id} — not yet implemented` });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    const srcLang = form.value.sourceLang;
    const srcTitle = (form.value.translations[srcLang]?.title ?? '').trim();

    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const translationsMap: Record<string, { title: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(form.value.translations)) {
        const title = (entry.title ?? '').trim();
        if (lang === srcLang || title) {
            translationsMap[lang] = { title, description: entry.description ?? '' };
        }
    }

    const payload: InformationFull = {
        status: form.value.status,
        sourceLang: srcLang,
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

// ─── Display helpers ──────────────────────────────────────────────────────────

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

function statusColor(status: InformationStatus): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'APPROVED' ? 'orange'
            : status === 'ARCHIVED' ? 'grey'
                : 'blue-grey';
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    await Promise.all([
        store.fetchAll(activeFilter.value),
        // Load information categories (subtype='information')
        categoryStore.categories.length === 0
            ? categoryStore.fetchAll('information')
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

.information-list-item {
    align-items: flex-start;
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