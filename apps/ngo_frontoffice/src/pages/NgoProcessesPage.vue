<template>
  <q-page padding>
    <div class="row q-col-gutter-md">

      <!-- ── List panel ──────────────────────────────────────────────────── -->
      <div :class="commentPanel.open ? 'col-12 col-md-6' : 'col-12'">

        <!-- Header -->
        <div class="row items-center q-mb-md">
          <div class="col">
            <div class="text-h5">{{ t('menu.process') }}</div>
            <div class="text-body2 text-grey-7">{{ t('menu.process_desc') }}</div>
          </div>
          <q-btn flat round icon="refresh" :loading="processStore.loading"
            @click="() => { void loadProcesses(); }" />
        </div>

        <!-- Search -->
        <q-input v-model="search" outlined dense clearable debounce="250"
          :placeholder="t('input_labels.search')" class="q-mb-md" style="max-width:360px">
          <template #prepend><q-icon name="search" /></template>
        </q-input>

        <!-- Error -->
        <q-banner v-if="processStore.error" class="bg-negative text-white q-mb-md" rounded>
          <template #avatar><q-icon name="error" /></template>
          {{ processStore.error }}
        </q-banner>

        <q-inner-loading :showing="processStore.loading" />

        <!-- Process list -->
        <q-list bordered separator>
          <q-item
            v-for="process in filteredProcesses" :key="process.id"
            clickable
            class="q-py-md process-item"
            :class="{ 'process-item--active': commentPanel.processId === process.id }"
            @click="openCommentPanel(process)"
          >
            <q-item-section>
              <q-item-label class="text-subtitle2 text-weight-medium">
                {{ process.title || t('input_labels.not_translated') }}
              </q-item-label>
              <q-item-label caption class="q-mt-xs">
                <q-badge color="grey-5" text-color="grey-9" class="q-mr-xs">
                  {{ process.stepCount }} {{ t('processes.steps_loaded') }}
                </q-badge>
                <q-badge :color="statusColor(process.status)">
                  {{ process.status }}
                </q-badge>
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row items-center q-gutter-xs">
                <!-- Comment count badge -->
                <q-badge
                  v-if="commentCounts[process.id]"
                  color="accent" rounded
                  :label="commentCounts[process.id]"
                />
                <q-icon name="chevron_right" color="grey-5" />
              </div>
            </q-item-section>
          </q-item>

          <q-item v-if="!processStore.loading && filteredProcesses.length === 0">
            <q-item-section class="text-grey-6 text-caption q-py-lg text-center">
              {{ search ? t('processes.no_results') : t('processes.empty') }}
            </q-item-section>
          </q-item>
        </q-list>

        <!-- Pagination -->
        <div v-if="processStore.totalCount > pageSize" class="row justify-center q-mt-md">
          <q-pagination v-model="currentPage" :max="totalPages"
            boundary-numbers color="accent" @update:model-value="onPageChange" />
        </div>
      </div>

      <!-- ── Comment panel ────────────────────────────────────────────────── -->
      <div v-if="commentPanel.open" class="col-12 col-md-6">
        <q-card flat bordered class="comment-panel">

          <!-- Panel header: process title + close -->
          <q-card-section class="row items-start q-pb-sm">
            <div class="col">
              <div class="text-caption text-grey-6 q-mb-xs">
                {{ t('ngo_comments.commenting_on') }}
              </div>
              <div class="text-subtitle1 text-weight-medium">
                {{ commentPanel.processTitle }}
              </div>
            </div>
            <q-btn flat round dense icon="close" @click="closeCommentPanel" />
          </q-card-section>

          <q-separator />

          <!-- Comment error -->
          <q-banner v-if="commentPanel.error"
            class="bg-negative text-white q-mx-md q-mt-sm" rounded dense>
            <template #avatar><q-icon name="error_outline" /></template>
            {{ commentPanel.error }}
            <template #action>
              <q-btn flat dense color="white" icon="close"
                @click="commentPanel.error = null" />
            </template>
          </q-banner>

          <q-card-section class="q-pt-sm">

            <!-- Existing comments -->
            <q-inner-loading :showing="commentPanel.loading" />

            <div v-if="!commentPanel.loading">

              <div v-if="commentPanel.comments.length === 0 && !commentPanel.editingNew"
                class="text-grey-6 text-caption q-py-md text-center">
                {{ t('ngo_comments.no_comments') }}
              </div>

              <div v-for="comment in commentPanel.comments" :key="comment.id"
                class="comment-row q-mb-sm">

                <template v-if="editingId === comment.id">
                  <!-- Inline edit form -->
                  <q-input v-model="editForm.body" type="textarea" outlined dense autogrow
                    :label="t('ngo_comments.your_comment')"
                    class="q-mb-xs" />
                  <div class="row items-center justify-between q-mt-xs">
                    <div class="row items-center q-gutter-sm">
                      <span class="text-body2 text-grey-7">{{ t('ngo_comments.publish') }}</span>
                      <q-toggle v-model="editForm.published" color="accent" dense />
                    </div>
                    <div class="row q-gutter-xs">
                      <q-btn flat dense no-caps :label="t('button.cancel')"
                        @click="cancelEdit" />
                      <q-btn color="accent" unelevated dense rounded no-caps
                        :label="t('button.save')" :loading="savingId === comment.id"
                        @click="() => { void saveEdit(comment.id); }" />
                    </div>
                  </div>
                </template>

                <template v-else>
                  <!-- Read mode -->
                  <div class="comment-bubble q-pa-sm">
                    <div class="row items-start justify-between q-mb-xs">
                      <div class="text-caption text-grey-6">
                        {{ comment.createdBy?.name || '—' }}
                        · {{ formatDate(comment.createdAt) }}
                      </div>
                      <div class="row q-gutter-xs">
                        <!-- Published toggle -->
                        <q-toggle
                          :model-value="comment.published" color="accent" dense
                          :title="t('ngo_comments.publish')"
                          @update:model-value="v => { void togglePublished(comment, v); }"
                        />
                        <q-btn flat round dense icon="edit" size="xs"
                          @click="startEdit(comment)" />
                        <q-btn flat round dense icon="delete" size="xs" color="negative"
                          @click="() => { void deleteComment(comment.id); }" />
                      </div>
                    </div>
                    <div class="text-body2" style="white-space: pre-wrap">{{ comment.body }}</div>
                  </div>
                </template>
              </div>

              <!-- New comment form -->
              <div v-if="commentPanel.editingNew" class="q-mt-md">
                <q-input v-model="newForm.body" type="textarea" outlined dense autogrow
                  :label="t('ngo_comments.your_comment')" class="q-mb-xs" />
                <div class="row items-center justify-between q-mt-xs">
                  <div class="row items-center q-gutter-sm">
                    <span class="text-body2 text-grey-7">{{ t('ngo_comments.publish') }}</span>
                    <q-toggle v-model="newForm.published" color="accent" dense />
                  </div>
                  <div class="row q-gutter-xs">
                    <q-btn flat dense no-caps :label="t('button.cancel')"
                      @click="commentPanel.editingNew = false" />
                    <q-btn color="accent" unelevated dense rounded no-caps
                      :label="t('button.save')" :loading="commentPanel.saving"
                      @click="() => { void submitNewComment(); }" />
                  </div>
                </div>
              </div>

              <!-- Add comment button -->
              <q-btn
                v-if="!commentPanel.editingNew && editingId === null"
                color="accent" unelevated rounded no-caps icon="add"
                :label="t('ngo_comments.add_comment')"
                class="q-mt-md full-width"
                @click="startNewComment"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>

    </div>
  </q-page>
</template>

<script setup lang="ts">
/**
 * NgoProcessesPage — /ngo-processes
 *
 * Two-panel layout:
 *   Left  — paginated list of PUBLISHED processes (read-only, same data as migrant app)
 *   Right — comment panel for the selected process: list, create, edit, publish toggle, delete
 *
 * The NGO user cannot edit processes themselves — they can only add comments
 * that describe what their organisation offers within each process step.
 *
 * API calls:
 *   GET /processes?...                     — list published processes (PA store)
 *   GET /ngo/process-comments?processId=   — list my group's comments
 *   POST /ngo/process-comments             — create
 *   PUT  /ngo/process-comments/:id         — update
 *   DEL  /ngo/process-comments/:id         — delete
 */
import { ref, computed, onMounted, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useProcessStore } from 'src/stores/process-store';
import { ngoProcessCommentApi, type NgoProcessComment } from 'src/api';
import type { Process, ProcessListFilter } from 'src/api/process.api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const processStore = useProcessStore();

// ── Pagination + filter ───────────────────────────────────────────────────────

const pageSize = 20;
const currentPage = ref(1);
const search = ref('');
const totalPages = computed(() => Math.ceil(processStore.totalCount / pageSize));

const filteredProcesses = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return processStore.processes;
  return processStore.processes.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q),
  );
});

async function loadProcesses(): Promise<void> {
  const filter: ProcessListFilter = { page: currentPage.value, pageSize };
  await processStore.fetchAll(filter);
}

function onPageChange(page: number): void {
  currentPage.value = page;
  void loadProcesses();
}

// ── Comment count cache (shown as badge on the list) ─────────────────────────
// Keyed by process.id (externalKey integer)

const commentCounts = ref<Record<number, number>>({});

async function loadCommentCount(processId: number): Promise<void> {
  try {
    const comments = await ngoProcessCommentApi.list(processId);
    commentCounts.value = { ...commentCounts.value, [processId]: comments.length };
  } catch {
    // Silently ignore — counts are informational only
  }
}

// ── Comment panel state ───────────────────────────────────────────────────────

const commentPanel = reactive<{
  open: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  processId: number | null;
  processTitle: string;
  comments: NgoProcessComment[];
  editingNew: boolean;
}>({
  open: false,
  loading: false,
  saving: false,
  error: null,
  processId: null,
  processTitle: '',
  comments: [],
  editingNew: false,
});

const editingId = ref<string | null>(null);
const savingId = ref<string | null>(null);

const editForm = reactive({ body: '', published: false });
const newForm = reactive({ body: '', published: false });

async function openCommentPanel(process: Process): Promise<void> {
  // If clicking the already-open process, close the panel
  if (commentPanel.processId === process.id && commentPanel.open) {
    closeCommentPanel();
    return;
  }

  commentPanel.open = true;
  commentPanel.processId = process.id;
  commentPanel.processTitle = process.title || `Process #${process.id}`;
  commentPanel.error = null;
  commentPanel.editingNew = false;
  editingId.value = null;
  await fetchComments(process.id);
}

function closeCommentPanel(): void {
  commentPanel.open = false;
  commentPanel.processId = null;
  commentPanel.comments = [];
  commentPanel.editingNew = false;
  commentPanel.error = null;
  editingId.value = null;
}

async function fetchComments(processId: number): Promise<void> {
  commentPanel.loading = true;
  commentPanel.error = null;
  try {
    commentPanel.comments = await ngoProcessCommentApi.list(processId);
    commentCounts.value = {
      ...commentCounts.value,
      [processId]: commentPanel.comments.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[NgoProcessesPage] fetchComments failed', e);
    commentPanel.error = msg;
  } finally {
    commentPanel.loading = false;
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

function startNewComment(): void {
  newForm.body = '';
  newForm.published = false;
  commentPanel.editingNew = true;
}

async function submitNewComment(): Promise<void> {
  if (!commentPanel.processId || !newForm.body.trim()) {
    $q.notify({ color: 'negative', message: t('warning.req_fields') });
    return;
  }
  commentPanel.saving = true;
  commentPanel.error = null;
  try {
    const created = await ngoProcessCommentApi.create({
      processId: commentPanel.processId,
      body: newForm.body,
      published: newForm.published,
    });
    commentPanel.comments.push(created);
    commentPanel.editingNew = false;
    commentCounts.value = {
      ...commentCounts.value,
      [commentPanel.processId]: commentPanel.comments.length,
    };
    $q.notify({ type: 'positive', message: t('ngo_comments.saved') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[NgoProcessesPage] create comment failed', e);
    commentPanel.error = msg;
  } finally {
    commentPanel.saving = false;
  }
}

// ── Edit ──────────────────────────────────────────────────────────────────────

function startEdit(comment: NgoProcessComment): void {
  editingId.value = comment.id;
  editForm.body = comment.body;
  editForm.published = comment.published;
}

function cancelEdit(): void {
  editingId.value = null;
}

async function saveEdit(id: string): Promise<void> {
  savingId.value = id;
  commentPanel.error = null;
  try {
    const updated = await ngoProcessCommentApi.update(id, {
      body: editForm.body,
      published: editForm.published,
    });
    const idx = commentPanel.comments.findIndex(c => c.id === id);
    if (idx !== -1) commentPanel.comments[idx] = updated;
    editingId.value = null;
    $q.notify({ type: 'positive', message: t('ngo_comments.saved') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[NgoProcessesPage] saveEdit failed', e);
    commentPanel.error = msg;
  } finally {
    savingId.value = null;
  }
}

// ── Publish toggle ────────────────────────────────────────────────────────────

async function togglePublished(comment: NgoProcessComment, newValue: boolean): Promise<void> {
  commentPanel.error = null;
  try {
    const updated = await ngoProcessCommentApi.update(comment.id, {
      body: comment.body,
      published: newValue,
    });
    const idx = commentPanel.comments.findIndex(c => c.id === comment.id);
    if (idx !== -1) commentPanel.comments[idx] = updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[NgoProcessesPage] togglePublished failed', e);
    commentPanel.error = msg;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteComment(id: string): Promise<void> {
  commentPanel.error = null;
  try {
    await ngoProcessCommentApi.remove(id);
    commentPanel.comments = commentPanel.comments.filter(c => c.id !== id);
    if (commentPanel.processId !== null) {
      commentCounts.value = {
        ...commentCounts.value,
        [commentPanel.processId]: commentPanel.comments.length,
      };
    }
    $q.notify({ type: 'positive', message: t('ngo_comments.deleted') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[NgoProcessesPage] deleteComment failed', e);
    commentPanel.error = msg;
  }
}

// ── Display helpers ───────────────────────────────────────────────────────────

function statusColor(status: string): string {
  return status === 'PUBLISHED' ? 'positive'
    : status === 'APPROVED' ? 'orange'
      : status === 'ARCHIVED' ? 'grey'
        : 'blue-grey';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadProcesses();
  // Pre-fetch comment counts for the first page so badges appear immediately
  for (const process of processStore.processes) {
    void loadCommentCount(process.id);
  }
});
</script>

<style scoped lang="scss">
.process-item {
  cursor: pointer;
  transition: background-color 0.15s;

  &:hover { background: rgba(0, 0, 0, 0.03); }

  &--active {
    background: rgba(11, 145, 206, 0.08);
    border-left: 3px solid var(--q-secondary);
  }
}

.comment-panel {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.comment-bubble {
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.comment-row + .comment-row {
  margin-top: 8px;
}
</style>
