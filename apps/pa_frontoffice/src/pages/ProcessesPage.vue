<template>
    <!--
    ProcessesPage — /guided_process_editor
    ════════════════════════════════════════════════════════════════════════════

    ── Layout ───────────────────────────────────────────────────────────────
      Full-width list (no filter sidebar — processes are few and filtered by
      search only). Same column structure as legacy ProcessManager:
        Name | Published | Translation state | Comments | Manage (graph) |
        Preview | Export | Edit

    ── Form (inline, replaces list) ─────────────────────────────────────────
      Matches Image 2 — "Add Process":
        • Process Name (input, required)
        • Process Description (RichTextEditor with @mentions)
        • Generated Documents (multi-select from published document types)
        • User Tags (TopicTreeSelect multi-accumulate → userTypeIds)
        • Topic Tags (TopicTreeSelect multi-accumulate → topicIds)
        • Translatable toggle (DRAFT ↔ APPROVED)
        • Cancel | Save
    -->
    <q-page padding>

        <!-- ── Page header ─────────────────────────────────────────────────── -->
        <div v-if="!formOpen" class="row items-center q-mb-md">
            <div class="col">
                <h5 class="q-my-none">{{ t('menu.process') }}</h5>
            </div>
            <div class="col-auto row q-gutter-sm">
                <q-input v-model="searchQuery" outlined dense :placeholder="t('input_labels.search')"
                    style="min-width: 260px">
                    <template #append><q-icon name="search" /></template>
                </q-input>
                <q-btn color="primary" no-caps unelevated :label="t('button.add_process')" @click="openNewForm"
                    data-cy="add_process" />
                <q-btn color="primary" no-caps unelevated :label="t('button.import_process')" @click="onImportClick" />
            </div>
        </div>

        <!-- ── Error banner ───────────────────────────────────────────────── -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ════════════════════════════════════════════════════════════════════
             FORM  (matches Image 2 — "Add Process")
             ════════════════════════════════════════════════════════════════════ -->
        <div v-if="formOpen">
            <div class="text-h5 text-center q-mb-sm">
                {{ isNew ? t('processes.add_new') : t('processes.edit') }}
            </div>

            <q-card class="q-pa-lg">

                <!-- Helper hints -->
                <div class="text-body2 text-center q-mb-md">
                    <div>• {{ t('help.keep_text_short') }}</div>
                    <div>• {{ t('help.fill_default_lang', { lang: defaultLangName }) }}</div>
                    <div>• {{ t('help.required_fields_star') }}</div>
                </div>

                <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

                <template v-if="!formLoading">

                    <!-- 1. Process Name -->
                    <HelpLabel :field-label="t('input_labels.process_name') + ' *'" :help-label="t('help.process_name')"
                        class="q-mb-xs" />
                    <q-input v-model="form.title" outlined dense :maxlength="255"
                        :rules="[v => !!v.trim() || t('warning.req_fields')]" :label="t('input_labels.process_name')"
                        data-cy="title_input" class="q-mb-md" />

                    <!-- 2. Process Description -->
                    <HelpLabel :field-label="t('input_labels.process_description') + ' *'"
                        :help-label="t('help.process_description')" class="q-mb-xs" />
                    <RichTextEditor v-model="form.description" data-cy="description_input" class="q-mb-md" />

                    <!-- 3. Generated Documents -->
                    <HelpLabel :field-label="t('input_labels.generated_docs') + ' *'"
                        :help-label="t('help.generated_docs')" class="q-mb-xs" />
                    <div class="row q-gutter-sm q-mb-md items-center">
                        <q-select v-model="form.newDocTypeId" :options="availableDocTypes" option-value="id"
                            option-label="document" emit-value map-options clearable outlined dense class="col"
                            :label="t('input_labels.generated_docs')" data-cy="produced_doc_select" />
                        <q-btn color="primary" no-caps unelevated :label="t('button.add_new_document_type')"
                            :disable="form.newDocTypeId == null" @click="addProducedDoc" data-cy="add_produced_doc" />
                    </div>
                    <!-- Added document type chips -->
                    <div class="row q-gutter-xs q-mb-md">
                        <q-chip v-for="dtId in form.producedDocTypeIds" :key="dtId" removable dense color="grey-3"
                            text-color="grey-9" @remove="removeProducedDoc(dtId)">
                            {{ docTypeLabel(dtId) }}
                        </q-chip>
                    </div>

                    <!-- 4. User Tags + Topic Tags (two columns) -->
                    <div class="row q-col-gutter-md q-mb-md">
                        <!-- User Tags -->
                        <div class="col-12 col-sm-6">
                            <HelpLabel :field-label="t('input_labels.user_tags')" :help-label="t('help.user_tags')"
                                class="q-mb-xs" />
                            <q-select v-model="form.userTypeIds" :options="userTypeOptions" option-value="id"
                                option-label="user_type" emit-value map-options multiple use-chips outlined dense
                                clearable :label="t('input_labels.user_tags')" data-cy="user_tags_select" />
                        </div>

                        <!-- Topic Tags -->
                        <div class="col-12 col-sm-6">
                            <HelpLabel :field-label="t('input_labels.topic_tags')" :help-label="t('help.topic_tags')"
                                class="q-mb-xs" />
                            <TopicTreeSelect v-model="form.topicPickId" :topics="topicStore.topics"
                                :max-selectable-depth="99" data-cy="topic_tags_select" />
                            <div class="q-mt-xs row q-gutter-xs">
                                <q-chip v-for="tid in form.topicIds" :key="tid" removable dense color="grey-3"
                                    text-color="grey-9" @remove="removeTopicId(tid)">
                                    {{ topicLabel(tid) }}
                                </q-chip>
                            </div>
                        </div>
                    </div>

                    <!-- 5. Translatable toggle -->
                    <div class="row items-center justify-between q-mb-md">
                        <span class="text-body2">{{ t('translation_states.translatable') }}</span>
                        <q-toggle :model-value="form.status === 'APPROVED'" :disable="form.status === 'PUBLISHED'"
                            color="accent" @update:model-value="v => form.status = v ? 'APPROVED' : 'DRAFT'" />
                    </div>

                </template>

                <!-- Form actions -->
                <div class="row q-gutter-sm q-mt-lg">
                    <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.cancel')"
                        @click="closeForm" />
                    <q-space />
                    <q-btn class="save_button" no-caps color="accent" unelevated rounded :label="t('button.save')"
                        :loading="store.loading" @click="onSave" data-cy="save_process" />
                </div>
            </q-card>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════
             LIST (matches Image 3)
             ════════════════════════════════════════════════════════════════════ -->
        <template v-if="!formOpen">

            <!-- Column headers -->
            <div class="row items-center q-px-sm q-mb-xs text-caption text-grey-7">
                <div class="col-4">{{ t('input_labels.name') }}</div>
                <div class="col-1 text-center">{{ t('lists.published') }}</div>
                <div class="col-2 text-center">{{ t('lists.translation_state') }}</div>
                <div class="col-1 text-center">{{ t('input_labels.comments') }}</div>
                <div class="col-1 text-center">{{ t('input_labels.manage') }}</div>
                <div class="col-1 text-center">{{ t('input_labels.export') }}</div>
                <div class="col-1 text-center">{{ t('lists.edit') }}</div>
            </div>
            <q-separator />

            <q-inner-loading :showing="store.loading" />

            <q-list separator>
                <q-item v-for="process in filteredBySearch" :key="process.id" class="q-py-sm process-list-item"
                    data-cy="process_list_item">
                    <!-- Name + tags -->
                    <q-item-section class="col-4">
                        <q-item-label class="text-subtitle2 text-weight-medium">
                            {{ process.title }}
                        </q-item-label>
                        <!-- Topic + user type icon pills -->
                        <div class="row q-gutter-x-xs q-mt-xs">
                            <q-avatar v-for="tid in process.topicIds" :key="`t${tid}`" size="20px"
                                :title="topicLabel(tid)" class="tag-icon">
                                <img v-if="topicIcon(tid)" :src="topicIcon(tid)" :alt="topicLabel(tid)" />
                                <q-icon v-else name="category" size="xs" />
                            </q-avatar>
                            <q-avatar v-for="uid in process.userTypeIds" :key="`u${uid}`" size="20px"
                                :title="userTypeLabel(uid)" class="tag-icon">
                                <img v-if="userTypeIcon(uid)" :src="userTypeIcon(uid)" :alt="userTypeLabel(uid)" />
                                <q-icon v-else name="person" size="xs" />
                            </q-avatar>
                        </div>
                        <!-- Available translations -->
                        <div class="text-caption text-grey-6 q-mt-xs">
                            {{ t('input_labels.available_transl') }}:
                        </div>
                    </q-item-section>

                    <!-- Published toggle -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-toggle :model-value="process.status === 'PUBLISHED'" :disable="process.status === 'DRAFT'"
                            color="accent" size="sm" @update:model-value="onPublishedToggle($event, process)" />
                    </q-item-section>

                    <!-- Translation state -->
                    <q-item-section class="col-2 flex flex-center">
                        <q-badge :color="statusColor(process.status)" :label="t(processStatusKey(process))" />
                    </q-item-section>

                    <!-- NGO Comments — grey pill when 0, clickable accent pill when > 0 -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn
                            v-if="(process.ngoCommentCount ?? 0) > 0"
                            unelevated rounded dense no-caps
                            color="accent" text-color="white"
                            size="sm" style="min-width:32px"
                            :label="String(process.ngoCommentCount)"
                            @click.stop="openCommentsDialog(process)"
                        />
                        <span v-else class="text-caption text-grey-5">0</span>
                    </q-item-section>

                    <!-- Manage (→ graph editor) -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn flat round size="sm" icon="account_tree" color="primary"
                            :title="t('help.manage_process')" :data-cy="`manage_process_${process.id}`"
                            @click="goToGraph(process.id)" />
                    </q-item-section>

                    <!-- Export -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn flat round size="sm" icon="download" color="grey-6" :title="t('input_labels.export')"
                            :data-cy="`export_process_${process.id}`" @click="onExport(process)" />
                    </q-item-section>

                    <!-- Edit -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn flat round size="sm" icon="edit" color="orange" :title="t('lists.edit')"
                            :data-cy="`edit_process_${process.id}`" @click="onEditRowClick(process)" />
                    </q-item-section>
                </q-item>

                <!-- Empty state -->
                <q-item v-if="!store.loading && filteredBySearch.length === 0">
                    <q-item-section class="text-grey-6 text-caption q-py-lg text-center">
                        {{ searchQuery ? t('processes.no_results') : t('processes.empty') }}
                    </q-item-section>
                </q-item>
            </q-list>

            <!-- Pagination -->
            <div v-if="store.totalCount > pageSize" class="row justify-center q-mt-md">
                <q-pagination v-model="currentPage" :max="totalPages" boundary-numbers color="accent"
                    @update:model-value="onPageChange" />
            </div>

        </template>
    </q-page>
    <!-- ── NGO Comments dialog ─────────────────────────────────────────────── -->
    <q-dialog v-model="commentsDialog.open" max-width="680px">
      <q-card style="width:680px; max-width:95vw">
        <q-card-section class="row items-center q-pb-none">
          <div>
            <div class="text-h6">{{ t('ngo_comments.dialog_title') }}</div>
            <div class="text-caption text-grey-7">{{ commentsDialog.processTitle }}</div>
          </div>
          <q-space />
          <q-btn flat round dense icon="close" @click="commentsDialog.open = false" />
        </q-card-section>

        <q-card-section>
          <q-inner-loading :showing="commentsDialog.loading" />

          <div v-if="!commentsDialog.loading">
            <div v-if="commentsDialog.comments.length === 0"
              class="text-grey-6 text-caption text-center q-py-lg">
              {{ t('ngo_comments.no_comments') }}
            </div>

            <q-list separator v-else>
              <q-item v-for="c in commentsDialog.comments" :key="c.id" class="q-py-sm">
                <q-item-section avatar>
                  <q-avatar color="accent" text-color="white" size="36px">
                    {{ groupInitials(c.ngoGroupName || c.ngoGroupId) }}
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>
                    <span class="text-weight-medium">{{ c.ngoGroupName || c.ngoGroupId }}</span>
                    <q-badge v-if="c.published" color="positive" class="q-ml-sm" dense>
                      {{ t('ngo_comments.published') }}
                    </q-badge>
                    <q-badge v-else color="grey-5" class="q-ml-sm" dense>
                      {{ t('ngo_comments.draft') }}
                    </q-badge>
                  </q-item-label>
                  <q-item-label caption class="q-mt-xs" style="white-space:pre-wrap">
                    {{ c.body }}
                  </q-item-label>
                  <q-item-label caption class="text-grey-5 q-mt-xs">
                    {{ c.createdBy?.name || c.createdBy?.username || '—' }}
                    · {{ formatCommentDate(c.createdAt) }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { useProcessStore } from 'src/stores/process-store';
import { useTopicStore } from 'src/stores/topic-store';
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useDocumentTypeStore } from 'src/stores/document-type-store';
import { useAppStore } from 'src/stores/app-store';
import { processStatusKey } from 'src/api/process.api';
//import { processApi } from 'src/api/process.api';
import type {
    Process,
    ProcessFull,
    ProcessListFilter,
    ProcessStatus,
    RevisionSummary,
    NgoCommentOnProcess,
} from 'src/api/process.api';
import HelpLabel from 'src/components/HelpLabel.vue';
import RichTextEditor from 'src/components/RichTextEditor.vue';
import TopicTreeSelect from 'src/components/settings/TopicTreeSelect.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const store = useProcessStore();
const topicStore = useTopicStore();
const userTypeStore = useUserTypeStore();
const docTypeStore = useDocumentTypeStore();
const appStore = useAppStore();

// ─── List state ───────────────────────────────────────────────────────────────

const searchQuery = ref('');
const activeFilter = ref<ProcessListFilter>({ page: 1, pageSize: 20 });
const currentPage = ref(1);
const pageSize = computed(() => activeFilter.value.pageSize ?? 20);
const totalPages = computed(() => Math.ceil(store.totalCount / pageSize.value));

const filteredBySearch = computed(() => {
    const q = searchQuery.value.toLowerCase().trim();
    if (!q) return store.processes;
    return store.processes.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
});

const defaultLangName = computed(() => appStore.defaultLangName ?? 'English');

function onPageChange(page: number): void {
    activeFilter.value = { ...activeFilter.value, page };
    void store.fetchAll(activeFilter.value);
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
    id: number;
    status: ProcessStatus;
    sourceLang: string;
    title: string;
    description: string;
    topicPickId: number | null;   // bound to TreeSelect single-pick
    topicIds: number[];           // accumulated
    userTypeIds: number[];
    producedDocTypeIds: number[];
    newDocTypeId: number | null;  // bound to produced-doc select
    revisions: RevisionSummary[];
}

const formOpen = ref(false);
const formLoading = ref(false);
const isNew = ref(false);

function blankForm(): FormState {
    return {
        id: -1,
        status: 'DRAFT',
        sourceLang: appStore.defaultLang || 'it',
        title: '',
        description: '',
        topicPickId: null,
        topicIds: [],
        userTypeIds: [],
        producedDocTypeIds: [],
        newDocTypeId: null,
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());

// Accumulate topic picks
watch(() => form.value.topicPickId, (id) => {
    if (id !== null && !form.value.topicIds.includes(id)) {
        form.value.topicIds.push(id);
    }
    form.value.topicPickId = null;
});

function removeTopicId(id: number): void {
    form.value.topicIds = form.value.topicIds.filter(t => t !== id);
}

function addProducedDoc(): void {
    if (form.value.newDocTypeId == null) return;
    if (!form.value.producedDocTypeIds.includes(form.value.newDocTypeId)) {
        form.value.producedDocTypeIds.push(form.value.newDocTypeId);
    }
    form.value.newDocTypeId = null;
}

function removeProducedDoc(id: number): void {
    form.value.producedDocTypeIds = form.value.producedDocTypeIds.filter(d => d !== id);
}

const userTypeOptions = computed(() => userTypeStore.userTypes);

/** Document types available to add (not yet in the list). */
const availableDocTypes = computed(() =>
    docTypeStore.documentTypes.filter(
        dt => !form.value.producedDocTypeIds.includes(dt.id),
    ),
);

// ─── Form lifecycle ───────────────────────────────────────────────────────────

function openNewForm(): void {
    form.value = blankForm();
    isNew.value = true;
    formOpen.value = true;
}

async function openEditForm(process: Process): Promise<void> {
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    // Optimistic fill from flat record
    form.value = {
        ...blankForm(),
        id: process.id,
        status: process.status,
        sourceLang: process.sourceLang,
        title: process.title,
        description: process.description,
        topicIds: [...process.topicIds],
        userTypeIds: [...process.userTypeIds],
        producedDocTypeIds: [...process.producedDocTypeIds],
    };

    // Load full DTO for all translations (we show only source lang in single-lang form)
    const full = await store.getOne(process.id);
    formLoading.value = false;
    if (!full) return;

    const srcLang = full.sourceLang ?? process.sourceLang;
    const srcTr = full.translations?.[srcLang];

    form.value.status = full.status ?? process.status;
    form.value.sourceLang = srcLang;
    form.value.title = srcTr?.title ?? process.title;
    form.value.description = srcTr?.description ?? process.description;
    form.value.topicIds = full.topicIds ? [...full.topicIds] : [...process.topicIds];
    form.value.userTypeIds = full.userTypeIds ? [...full.userTypeIds] : [...process.userTypeIds];
    form.value.producedDocTypeIds = full.producedDocTypeIds ? [...full.producedDocTypeIds] : [...process.producedDocTypeIds];
    form.value.revisions = full.revisions ?? [];

    logger.info('[ProcessesPage] openEditForm loaded', { id: process.id });
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    const srcTitle = form.value.title.trim();
    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const srcLang = form.value.sourceLang;

    const payload: ProcessFull = {
        status: form.value.status,
        sourceLang: srcLang,
        topicIds: [...form.value.topicIds],
        userTypeIds: [...form.value.userTypeIds],
        producedDocTypeIds: [...form.value.producedDocTypeIds],
        translations: {
            [srcLang]: { title: srcTitle, description: form.value.description },
        },
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

// ─── List actions ─────────────────────────────────────────────────────────────

function onEditRowClick(process: Process): void {
    void openEditForm(process);
}

function goToGraph(id: number): void {
    void router.push({ name: 'process-graph', params: { id } });
}

function onPublishedToggle(newValue: boolean, process: Process): void {
    if (newValue) void store.publish(process.id);
    else void store.unpublish(process.id);
}

function onExport(process: Process): void {
    logger.info('[ProcessesPage] export', { id: process.id });
    $q.notify({ type: 'info', message: `Export process ${process.id} — not yet implemented` });
}

function onImportClick(): void {
    $q.notify({ type: 'info', message: t('processes.import_not_implemented') });
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

function userTypeIcon(id: number): string {
    return userTypeStore.userTypes.find(u => u.id === id)?.dataExtra?.icon ?? '';
}

function docTypeLabel(id: number): string {
    return docTypeStore.documentTypes.find(d => d.id === id)?.document ?? String(id);
}

function statusColor(status: ProcessStatus): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'APPROVED' ? 'orange'
            : status === 'ARCHIVED' ? 'grey'
                : 'blue-grey';
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// ─── NGO Comments dialog ─────────────────────────────────────────────────────

interface CommentsDialogState {
    open: boolean;
    loading: boolean;
    processId: number | null;
    processTitle: string;
    comments: NgoCommentOnProcess[];
}

const commentsDialog = reactive<CommentsDialogState>({
    open: false,
    loading: false,
    processId: null,
    processTitle: '',
    comments: [],
});

async function openCommentsDialog(process: Process): Promise<void> {
    commentsDialog.processId = process.id;
    commentsDialog.processTitle = process.title || `Process #${process.id}`;
    commentsDialog.comments = [];
    commentsDialog.open = true;
    commentsDialog.loading = true;
    try {
        const full = await store.getOne(process.id);
        commentsDialog.comments = full?.ngoComments ?? [];
    } catch (e) {
        logger.error('[ProcessesPage] openCommentsDialog failed', e);
    } finally {
        commentsDialog.loading = false;
    }
}

function groupInitials(name: string): string {
    return name
        .split(/[\s-_]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');
}

function formatCommentDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

onMounted(async () => {
    await Promise.all([
        store.fetchAll(activeFilter.value),
        topicStore.topics.length === 0 ? topicStore.fetchAll() : Promise.resolve(),
        userTypeStore.userTypes.length === 0 ? userTypeStore.fetchAll() : Promise.resolve(),
        docTypeStore.documentTypes.length === 0 ? docTypeStore.fetchAll() : Promise.resolve(),
    ]);
});
</script>

<style scoped lang="scss">
.process-list-item {
    align-items: center;
}

.tag-icon {
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