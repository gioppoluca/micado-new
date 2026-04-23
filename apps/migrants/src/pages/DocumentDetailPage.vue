<template>
  <q-page class="doc-page q-pa-md">

    <q-inner-loading :showing="store.loading" />

    <template v-if="!store.loading && doc">

      <!-- ── Page title ───────────────────────────────────────────────────── -->
      <div class="row items-center justify-center q-mb-md">
        <div class="text-h6 text-primary text-weight-bold">
          {{ typeLabel || doc.fileName }}
        </div>
      </div>

      <!-- ── Document preview ─────────────────────────────────────────────── -->
      <div class="doc-preview q-mb-md">
        <img
          v-if="isImage && dataUri"
          :src="dataUri"
          :alt="doc.fileName"
          class="doc-image"
        />
        <div v-else class="doc-pdf-placeholder column items-center justify-center">
          <q-icon name="picture_as_pdf" size="64px" color="red-7" />
          <div class="text-body2 text-grey-7 q-mt-sm">{{ doc.fileName }}</div>
        </div>
      </div>

      <!-- ── Action bar (edit, share, download, delete) ──────────────────── -->
      <div class="row justify-around q-mb-lg">
        <q-btn
          flat round icon="edit" color="orange"
          :title="t('button.edit')"
          @click="goEdit"
        />
        <q-btn
          flat round icon="send" color="primary"
          :title="t('documents.share_label')"
          :disable="!doc.shareable"
          @click="goSend"
        />
        <q-btn
          flat round icon="download" color="grey-7"
          :title="t('button.download')"
          @click="download"
        />
        <q-btn
          flat round icon="delete_forever" color="negative"
          :title="t('button.delete')"
          @click="confirmDelete = true"
        />
      </div>

      <q-separator class="q-mb-md" />

      <!-- ── Metadata ─────────────────────────────────────────────────────── -->
      <div class="q-mb-sm">
        <div class="text-weight-bold q-mb-xs">{{ t('documents.document_type') }}:</div>
        <div class="text-body2">{{ typeLabel || '—' }}</div>
      </div>

      <q-separator class="q-my-sm" />

      <div class="q-mb-sm">
        <div class="text-weight-bold q-mb-xs">{{ t('documents.issuer') }}:</div>
        <div class="text-body2">{{ issuerLabel || '—' }}</div>
      </div>

      <q-separator class="q-my-sm" />

      <!-- ── Go Back ──────────────────────────────────────────────────────── -->
      <div class="row justify-center q-mt-xl">
        <q-btn
          outline rounded no-caps icon="arrow_back"
          :label="t('button.go_back')"
          class="go-back-btn"
          @click="router.back()"
        />
      </div>

    </template>

    <!-- ── Not found ──────────────────────────────────────────────────────── -->
    <div v-if="!store.loading && !doc" class="column items-center q-pt-xl text-grey-6">
      <q-icon name="folder_off" size="48px" class="q-mb-sm" />
      <div>{{ t('documents.not_found') }}</div>
      <q-btn flat no-caps :label="t('button.go_back')" class="q-mt-md" @click="router.back()" />
    </div>

    <!-- ── Delete confirmation ───────────────────────────────────────────── -->
    <q-dialog v-model="confirmDelete" persistent>
      <q-card>
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon name="warning" color="negative" size="28px" />
          <div class="text-h6">{{ t('documents.delete_confirm_title') }}</div>
        </q-card-section>
        <q-card-section>{{ t('documents.delete_confirm_body') }}</q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('button.cancel')" @click="confirmDelete = false" />
          <q-btn
            color="negative" unelevated rounded no-caps
            :label="t('button.delete')" :loading="store.loading"
            @click="() => { void submitDelete(); }"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script setup lang="ts">
/**
 * DocumentDetailPage — /document-wallet/:id
 *
 * Shows a full document preview with metadata and action buttons.
 * The binary is fetched on demand (fetchOne loads the full record with base64 data).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useDocumentStore } from 'src/stores/document-store';
import { buildDataUri } from 'src/api/document.api';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const store = useDocumentStore();

const confirmDelete = ref(false);

const id = computed(() => route.params.id as string);
const doc = computed(() => store.selectedDocument);

// ── Derived display values ─────────────────────────────────────────────────────

const typeLabel = computed(() => {
  if (!doc.value?.documentTypeId) return '';
  return store.documentTypes.find(dt => dt.id === doc.value!.documentTypeId)?.document ?? '';
});

const issuerLabel = computed(() => {
  if (!doc.value?.documentTypeId) return '';
  return store.documentTypes.find(dt => dt.id === doc.value!.documentTypeId)?.issuer ?? '';
});

const isImage = computed(() => doc.value?.mimeType.startsWith('image/') ?? false);

const dataUri = computed(() => {
  if (!doc.value?.fileData || !doc.value.mimeType) return '';
  return buildDataUri(doc.value.fileData, doc.value.mimeType);
});

// ── Actions ───────────────────────────────────────────────────────────────────

function goEdit(): void {
  void router.push({ name: 'document-edit', params: { id: id.value } });
}

function goSend(): void {
  void router.push({ name: 'document-send', params: { id: id.value } });
}

function download(): void {
  if (!doc.value) return;
  const uri = dataUri.value || `data:${doc.value.mimeType};base64,${doc.value.fileData}`;
  const a = document.createElement('a');
  a.href = uri;
  a.download = doc.value.fileName;
  a.click();
}

async function submitDelete(): Promise<void> {
  const ok = await store.remove(id.value);
  if (ok) {
    confirmDelete.value = false;
    $q.notify({ type: 'positive', message: t('documents.delete_success') });
    void router.replace({ name: 'document-wallet' });
  } else {
    confirmDelete.value = false;
    $q.notify({ color: 'negative', message: store.error ?? t('error.generic') });
    store.clearError();
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Ensure document types are loaded (for labels)
  await Promise.all([
    store.fetchDocumentTypes(),
    store.fetchOne(id.value),
  ]);
});

onUnmounted(() => {
  store.clearSelected();
});
</script>

<style scoped lang="scss">
.doc-page {
  max-width: 480px;
  margin: 0 auto;
}

.doc-preview {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.doc-image {
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  display: block;
}

.doc-pdf-placeholder {
  height: 160px;
}

.go-back-btn {
  border-color: var(--micado-header);
  color: var(--micado-header);
  min-width: 180px;
}
</style>
