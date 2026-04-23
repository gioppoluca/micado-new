<template>
  <q-page class="doc-page q-pa-md">

    <q-inner-loading :showing="store.loading && !doc" />

    <template v-if="doc">

      <!-- ── Page title ───────────────────────────────────────────────────── -->
      <div class="row items-center q-mb-lg">
        <q-icon name="edit" color="orange" size="24px" class="q-mr-sm" />
        <div class="text-h6">{{ t('documents.edit_title') }}</div>
      </div>

      <!-- ── Error ────────────────────────────────────────────────────────── -->
      <q-banner v-if="formError" class="bg-negative text-white q-mb-md" rounded dense>
        <template #avatar><q-icon name="error_outline" /></template>
        {{ formError }}
        <template #action>
          <q-btn flat dense color="white" icon="close" @click="formError = null" />
        </template>
      </q-banner>

      <!-- ── Shareable toggle ─────────────────────────────────────────────── -->
      <q-separator class="q-mb-sm" />
      <q-item dense class="q-px-none q-mb-sm">
        <q-item-section avatar>
          <q-checkbox v-model="form.shareable" color="primary" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ t('documents.shareable_label') }}</q-item-label>
        </q-item-section>
      </q-item>
      <q-separator class="q-mb-md" />

      <!-- ── Change Document Type ─────────────────────────────────────────── -->
      <div class="text-body2 text-grey-7 q-mb-xs">{{ t('documents.change_type') }}:</div>
      <q-select
        v-model="form.documentTypeId"
        :options="store.documentTypes" option-value="id" option-label="document"
        emit-value map-options clearable outlined dense
        :label="t('documents.document_type')"
        class="q-mb-lg"
      />

      <!-- ── Change Image ─────────────────────────────────────────────────── -->
      <div class="text-body2 text-grey-7 q-mb-sm">{{ t('documents.change_image') }}:</div>

      <q-btn
        v-if="form.previewUrl"
        outline rounded no-caps color="negative" icon="delete"
        :label="t('documents.delete_image')"
        class="full-width q-mb-sm"
        @click="clearImage"
      />

      <q-btn
        unelevated rounded no-caps color="primary" icon="camera_alt"
        :label="t('documents.upload_new_image')"
        class="full-width q-mb-md"
        @click="triggerFilePicker"
      />
      <input
        ref="fileInputRef" type="file"
        accept="image/*,application/pdf"
        style="display:none"
        @change="onFileChange"
      />

      <!-- Current/new preview -->
      <div v-if="form.previewUrl && form.isImage" class="doc-preview q-mb-md">
        <img :src="form.previewUrl" class="doc-image" />
      </div>
      <div v-else-if="form.previewUrl && !form.isImage" class="column items-center q-mb-md">
        <q-icon name="picture_as_pdf" size="48px" color="red-7" />
        <div class="text-caption text-grey-7">{{ form.fileName }}</div>
      </div>

    </template>

    <!-- ── Footer action bar (fixed) ────────────────────────────────────── -->
    <q-footer class="bg-white shadow-2 q-pa-sm">
      <div class="row q-gutter-sm justify-center">
        <q-btn
          outline rounded no-caps icon="close"
          :label="t('button.cancel')"
          class="cancel-btn"
          :disable="store.uploading"
          @click="router.back()"
        />
        <q-btn
          unelevated rounded no-caps icon="check"
          :label="t('button.save')"
          class="save-btn"
          :loading="store.uploading"
          @click="() => { void submitSave(); }"
        />
      </div>
    </q-footer>

  </q-page>
</template>

<script setup lang="ts">
/**
 * DocumentEditPage — /document-wallet/:id/edit
 *
 * Allows the migrant to change:
 *   - The document type (dropdown)
 *   - The shareable flag (checkbox)
 *   - The document image/file (optional — keeps existing if not changed)
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
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

const id = computed(() => route.params.id as string);
const doc = computed(() => store.selectedDocument);
const fileInputRef = ref<HTMLInputElement | null>(null);
const formError = ref<string | null>(null);

// ── Form state ────────────────────────────────────────────────────────────────

const form = reactive({
  documentTypeId: null as number | null,
  shareable: false,
  fileName: '',
  mimeType: '',
  newFileData: '' as string,   // base64 of the new file, empty = keep existing
  previewUrl: '',
  isImage: false,
});

function populateForm(): void {
  if (!doc.value) return;
  form.documentTypeId = doc.value.documentTypeId ?? null;
  form.shareable = doc.value.shareable;
  form.fileName = doc.value.fileName;
  form.mimeType = doc.value.mimeType;
  form.newFileData = '';
  form.isImage = doc.value.mimeType.startsWith('image/');
  form.previewUrl = doc.value.fileData
    ? buildDataUri(doc.value.fileData, doc.value.mimeType)
    : '';
}

// ── File replacement ──────────────────────────────────────────────────────────

function triggerFilePicker(): void {
  fileInputRef.value?.click();
}

function onFileChange(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  formError.value = null;
  form.fileName = file.name;
  form.mimeType = file.type || 'application/octet-stream';
  form.isImage = file.type.startsWith('image/');
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result as string;
    form.newFileData = result;
    form.previewUrl = form.isImage ? result : result; // always set for pdf too
  };
  reader.readAsDataURL(file);
}

function clearImage(): void {
  form.newFileData = '';
  form.previewUrl = '';
  form.fileName = '';
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function submitSave(): Promise<void> {
  formError.value = null;

  const payload: Record<string, unknown> = {
    shareable: form.shareable,
  };
  if (form.documentTypeId !== null) {
    payload['documentTypeId'] = form.documentTypeId;
  }
  if (form.newFileData) {
    payload['fileData'] = form.newFileData;
    payload['fileName'] = form.fileName;
    payload['mimeType'] = form.mimeType;
  }

  const updated = await store.update(id.value, payload as Parameters<typeof store.update>[1]);
  if (updated) {
    $q.notify({ type: 'positive', message: t('documents.save_success') });
    void router.replace({ name: 'document-detail', params: { id: id.value } });
  } else if (store.error) {
    formError.value = store.error;
    store.clearError();
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([
    store.fetchDocumentTypes(),
    store.selectedDocument?.id !== id.value ? store.fetchOne(id.value) : Promise.resolve(),
  ]);
  populateForm();
});

onUnmounted(() => {
  store.clearSelected();
});
</script>

<style scoped lang="scss">
.doc-page {
  max-width: 480px;
  margin: 0 auto;
  padding-bottom: 80px; // space for fixed footer
}

.doc-preview {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.doc-image {
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  display: block;
}

.cancel-btn {
  border-color: #c10015;
  color: #c10015;
  min-width: 130px;
}

.save-btn {
  background: var(--micado-header) !important;
  color: #fff;
  min-width: 130px;
}
</style>
