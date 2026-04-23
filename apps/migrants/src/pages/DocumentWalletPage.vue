<template>
  <q-page class="doc-page q-pa-md">

    <!-- ── Header illustration ─────────────────────────────────────────────── -->
    <div class="column items-center q-mb-md">
      <q-icon name="folder_open" size="72px" color="primary" />
    </div>

    <!-- ── Error banner ────────────────────────────────────────────────────── -->
    <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded dense>
      <template #avatar><q-icon name="error_outline" /></template>
      {{ store.error }}
      <template #action>
        <q-btn flat dense color="white" icon="close" @click="store.clearError()" />
      </template>
    </q-banner>

    <!-- ── Add Document button ─────────────────────────────────────────────── -->
    <div class="row justify-center q-mb-md">
      <q-btn
        unelevated rounded no-caps color="primary"
        icon="add" :label="t('documents.add_document')"
        class="add-btn"
        @click="openUploadDialog"
      />
    </div>

    <!-- ── Loading ─────────────────────────────────────────────────────────── -->
    <q-inner-loading :showing="store.loading" />

    <!-- ── Document list ───────────────────────────────────────────────────── -->
    <q-list separator class="doc-list">
      <q-item
        v-for="doc in store.documents" :key="doc.id"
        clickable class="doc-item q-py-sm"
        @click="goDetail(doc.id)"
      >
        <!-- Thumbnail -->
        <q-item-section avatar>
          <q-avatar square size="52px" class="doc-thumb">
            <q-icon
              :name="fileIcon(doc.mimeType)"
              size="32px"
              :color="fileIconColor(doc.mimeType)"
            />
          </q-avatar>
        </q-item-section>

        <!-- Name + type label -->
        <q-item-section>
          <q-item-label class="text-weight-medium">
            {{ typeLabel(doc.documentTypeId) || doc.fileName }}
          </q-item-label>
          <q-item-label caption class="text-grey-6">{{ doc.fileName }}</q-item-label>
        </q-item-section>

        <!-- Actions -->
        <q-item-section side>
          <div class="row items-center q-gutter-xs">
            <q-icon name="chevron_right" color="grey-5" />
          </div>
        </q-item-section>
      </q-item>

      <!-- Empty state -->
      <q-item v-if="!store.loading && store.documents.length === 0">
        <q-item-section class="text-center text-grey-6 q-py-xl">
          {{ t('documents.no_documents') }}
        </q-item-section>
      </q-item>
    </q-list>

    <!-- ── Upload dialog ───────────────────────────────────────────────────── -->
    <q-dialog v-model="uploadDialog.open" persistent>
      <q-card class="upload-card">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ t('documents.add_document') }}</div>
          <q-space />
          <q-btn flat round dense icon="close" @click="closeUploadDialog" />
        </q-card-section>

        <q-card-section>
          <!-- Error inside dialog -->
          <q-banner v-if="uploadDialog.error" class="bg-negative text-white q-mb-sm" rounded dense>
            <template #avatar><q-icon name="error_outline" /></template>
            {{ uploadDialog.error }}
            <template #action>
              <q-btn flat dense color="white" icon="close" @click="uploadDialog.error = null" />
            </template>
          </q-banner>

          <!-- Document type picker -->
          <q-select
            v-model="uploadDialog.documentTypeId"
            :options="typeOptions" option-value="id" option-label="document"
            emit-value map-options clearable outlined dense
            :label="t('documents.document_type')"
            class="q-mb-md"
          />

          <!-- Shareable toggle -->
          <q-item dense class="q-mb-sm q-px-none">
            <q-item-section>
              <q-item-label>{{ t('documents.shareable_label') }}</q-item-label>
              <q-item-label caption>{{ t('documents.shareable_hint') }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-toggle v-model="uploadDialog.shareable" color="primary" />
            </q-item-section>
          </q-item>

          <!-- File picker -->
          <q-file
            v-model="uploadDialog.file"
            outlined dense accept="image/*,application/pdf"
            :label="t('documents.choose_file')"
            class="q-mb-xs"
            @update:model-value="onFileSelected"
          >
            <template #prepend><q-icon name="attach_file" /></template>
          </q-file>

          <!-- Preview (image only) -->
          <div v-if="uploadDialog.previewUrl && uploadDialog.isImage" class="q-mt-sm">
            <img :src="uploadDialog.previewUrl" class="upload-preview" />
          </div>
          <div v-else-if="uploadDialog.file && !uploadDialog.isImage" class="text-caption text-grey-7 q-mt-xs">
            {{ uploadDialog.file.name }} ({{ t('documents.pdf_selected') }})
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('button.cancel')" @click="closeUploadDialog" />
          <q-btn
            color="primary" unelevated rounded no-caps
            :label="t('button.save')" :loading="store.uploading"
            :disable="!uploadDialog.fileData"
            @click="() => { void submitUpload(); }"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script setup lang="ts">
/**
 * DocumentWalletPage — /document-wallet
 *
 * List of the authenticated migrant's personal documents.
 * Gated by FEAT_MIGRANT_LOGIN + FEAT_DOCUMENTS (enforced in router + MainLayout).
 */
import { onMounted, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useDocumentStore } from 'src/stores/document-store';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const store = useDocumentStore();

// ── Type picker options ────────────────────────────────────────────────────────

const typeOptions = computed(() => store.documentTypes);

function typeLabel(docTypeId?: number): string {
  if (!docTypeId) return '';
  return store.documentTypes.find(dt => dt.id === docTypeId)?.document ?? '';
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'picture_as_pdf';
  return 'insert_drive_file';
}

function fileIconColor(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'blue-7';
  if (mimeType === 'application/pdf') return 'red-7';
  return 'grey-6';
}

// ── Navigation ────────────────────────────────────────────────────────────────

function goDetail(id: string): void {
  void router.push({ name: 'document-detail', params: { id } });
}

// ── Upload dialog ─────────────────────────────────────────────────────────────

const uploadDialog = reactive({
  open: false,
  documentTypeId: null as number | null,
  shareable: false,
  file: null as File | null,
  fileData: '' as string,
  previewUrl: '' as string,
  isImage: false,
  error: null as string | null,
});

function openUploadDialog(): void {
  uploadDialog.open = true;
  uploadDialog.documentTypeId = null;
  uploadDialog.shareable = false;
  uploadDialog.file = null;
  uploadDialog.fileData = '';
  uploadDialog.previewUrl = '';
  uploadDialog.isImage = false;
  uploadDialog.error = null;
}

function closeUploadDialog(): void {
  if (store.uploading) return;
  uploadDialog.open = false;
}

function onFileSelected(file: File | null): void {
  uploadDialog.error = null;
  if (!file) { uploadDialog.fileData = ''; uploadDialog.previewUrl = ''; return; }

  uploadDialog.isImage = file.type.startsWith('image/');

  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result as string;
    uploadDialog.fileData = result;          // full data-URI — backend strips prefix
    if (uploadDialog.isImage) uploadDialog.previewUrl = result;
  };
  reader.readAsDataURL(file);
}

async function submitUpload(): Promise<void> {
  if (!uploadDialog.file || !uploadDialog.fileData) return;

  uploadDialog.error = null;
  const created = await store.upload({
    ...(uploadDialog.documentTypeId != null && { documentTypeId: uploadDialog.documentTypeId }),
    fileName: uploadDialog.file.name,
    mimeType: uploadDialog.file.type || 'application/octet-stream',
    fileData: uploadDialog.fileData,
    shareable: uploadDialog.shareable,
  });

  if (created) {
    uploadDialog.open = false;
    $q.notify({ type: 'positive', message: t('documents.upload_success') });
  } else if (store.error) {
    uploadDialog.error = store.error;
    store.clearError();
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([
    store.fetchList(),
    store.fetchDocumentTypes(),
  ]);
  logger.info('[DocumentWalletPage] mounted', { count: store.documents.length });
});
</script>

<style scoped lang="scss">
.doc-page {
  max-width: 480px;
  margin: 0 auto;
}

.add-btn {
  min-width: 200px;
  background: var(--micado-header) !important;
}

.doc-list {
  border-radius: 8px;
  overflow: hidden;
}

.doc-item {
  background: #fff;
  transition: background 0.15s;
  &:hover { background: #f5f5f5; }
}

.doc-thumb {
  background: #f0f4f8;
  border-radius: 6px;
}

.upload-card {
  width: 420px;
  max-width: 95vw;
}

.upload-preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}
</style>
