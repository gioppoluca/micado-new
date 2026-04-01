<template>
    <!--
    DocumentTypesPage — /data_settings/document_types

    Form sections (in order):
      1. MultiLangEditorTabs   title + description per language
      2. Metadata row          issuer (text input) + icon (file → base64)
      3. Validable + duration  checkbox + optional number field
      4. Validators            q-select multiple, shown only when validable=true
      5. Model template        PDF upload → base64 in dataExtra.model_template
      6. Pictures              image upload → array of DocumentPicture in dataExtra
      7. Hotspot editor        PictureHotspotEditor per picture tab (custom component)
      8. Send-to-translation   DRAFT ↔ APPROVED toggle
      9. Version history       revision chips, read-only
    -->
    <q-page padding>

        <!-- Header -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('data_settings.document_types') }}</h5>
            <div class="col-auto row q-gutter-sm">
                <q-btn data-cy="adddoctype" color="info" no-caps :label="t('button.add_type')" :disable="formOpen"
                    @click="openNewForm" />
                <input ref="importInputRef" type="file" accept=".json" style="display: none"
                    @change="onImportFileSelected" />
                <q-btn color="accent" unelevated rounded no-caps :label="t('button.import')"
                    @click="importInputRef?.click()" />
            </div>
        </div>

        <!-- Error banner -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- Icon size warning -->
        <q-banner v-if="iconSizeError" class="bg-warning text-white q-mb-md" rounded>
            <template #avatar><q-icon name="warning" /></template>
            {{ iconSizeError }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="iconSizeError = null" />
            </template>
        </q-banner>

        <!-- Model size warning -->
        <q-banner v-if="modelSizeError" class="bg-warning text-white q-mb-md" rounded>
            <template #avatar><q-icon name="warning" /></template>
            {{ modelSizeError }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="modelSizeError = null" />
            </template>
        </q-banner>

        <!-- ════════════════════════════════════════════════════════════════════
             FORM
             ════════════════════════════════════════════════════════════════════ -->
        <q-card v-if="formOpen" class="q-pa-md q-mb-lg">

            <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

            <!-- 1. Title + description per language -->
            <HelpLabel :field-label="t('input_labels.doc_type')" :help-label="t('help.doc_type_description')"
                class="q-mb-xs" />
            <MultiLangEditorTabs v-if="!formLoading" ref="mlTabsRef" v-model="form.translations"
                :languages="sortedLanguages" :show-title="true" :title-max-length="titleLimit" :readonly="false"
                data-cy="doctype_multilang_tabs" />

            <!-- 2. Issuer + Icon -->
            <div class="row q-gutter-md q-mt-md">
                <div class="col">
                    <HelpLabel :field-label="t('input_labels.issuer')" :help-label="t('help.issuer')" class="q-mb-xs" />
                    <q-input v-model="form.issuer" outlined dense :maxlength="20" :label="t('input_labels.issuer')"
                        :readonly="!isEditable" />
                </div>
                <div class="col">
                    <HelpLabel :field-label="t('input_labels.icon')" :help-label="t('help.doc_type_icon')"
                        class="q-mb-xs" />
                    <div class="row items-center q-gutter-sm">
                        <q-img v-if="form.iconPreview" :src="form.iconPreview"
                            style="width:48px;height:48px;object-fit:contain" />
                        <q-icon v-else name="description" size="48px" color="grey-4" />
                        <div class="column q-gutter-xs">
                            <q-file v-if="isEditable" v-model="iconFileRef" dense outlined accept="image/*"
                                :label="t('button.upload')" @update:model-value="onIconSelected" />
                            <span class="text-caption text-grey-6">
                                {{ t('help.icon_max_size', { size: iconMaxKb }) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 3. Validable + validity duration -->
            <div class="row items-center q-gutter-md q-mt-md">
                <div class="col-auto row items-center q-gutter-xs">
                    <HelpLabel :field-label="t('input_labels.validable')" :help-label="t('help.validable')" />
                    <q-checkbox v-model="form.validable" color="accent" :disable="!isEditable" />
                </div>
                <div class="col">
                    <q-input v-model.number="form.validityDuration" type="number" outlined dense
                        :label="t('input_labels.validity_duration')" :hint="t('help.validity_duration_hint')"
                        :readonly="!isEditable" clearable />
                </div>
            </div>

            <!-- 4. Validators (only when validable=true) -->
            <div v-if="form.validable" class="q-mt-md">
                <HelpLabel :field-label="t('input_labels.validators')" :help-label="t('help.validators')"
                    class="q-mb-xs" />
                <q-select v-model="form.validatorIds" :options="store.tenants"
                    :option-value="(o: TenantOption) => o.value" :option-label="(o: TenantOption) => o.label" emit-value
                    map-options multiple use-chips dense outlined :label="t('input_labels.validators')"
                    :readonly="!isEditable" />
            </div>

            <!-- 5. Model template (PDF upload) -->
            <div class="q-mt-md">
                <HelpLabel :field-label="t('input_labels.upload_model')" :help-label="t('help.upload_model')"
                    class="q-mb-xs" />
                <div class="row items-center q-gutter-sm">
                    <q-file v-if="isEditable" v-model="modelFileRef" dense outlined accept=".pdf"
                        :label="t('input_labels.upload_model')" @update:model-value="onModelSelected" />
                    <div v-if="form.modelTemplate" class="row items-center q-gutter-xs">
                        <q-icon name="picture_as_pdf" color="negative" />
                        <span class="text-caption">{{ t('input_labels.model_uploaded') }}</span>
                        <q-btn v-if="isEditable" flat dense round icon="close" size="xs"
                            @click="form.modelTemplate = null" />
                    </div>
                </div>
                <span class="text-caption text-grey-6">
                    {{ t('help.icon_max_size', { size: modelMaxKb }) }}
                </span>
            </div>

            <!-- 6 + 7. Pictures + hotspot editor -->
            <q-separator class="q-my-md" />
            <HelpLabel :field-label="t('input_labels.doc_pics')" :help-label="t('help.doc_pics')" class="q-mb-xs" />

            <q-file v-if="isEditable" v-model="pictureFileRef" dense outlined accept="image/*"
                :label="t('input_labels.upload_doc_pics')" class="q-mb-md" @update:model-value="onPictureSelected" />

            <div v-if="form.pictures.length > 0">
                <!-- Picture tabs -->
                <q-tabs v-model="activePictureTab" dense align="left" active-color="accent" indicator-color="accent">
                    <q-tab v-for="(pic, idx) in form.pictures" :key="pic.id" :name="pic.id"
                        :label="`${t('input_labels.image')} ${idx + 1}`" />
                </q-tabs>

                <q-tab-panels v-model="activePictureTab" animated class="q-mt-sm">
                    <q-tab-panel v-for="pic in form.pictures" :key="pic.id" :name="pic.id" class="q-pa-none">
                        <div class="row items-start q-gutter-md">
                            <div class="col">
                                <!--
                                PictureHotspotEditor:
                                  - click on image → add pin at that position
                                  - drag pin → move it
                                  - click pin → open per-lang title + message form
                                  - delete button in form → remove pin
                                  Coords are 0-100% of the image dimensions.
                                -->
                                <PictureHotspotEditor :picture="pic" :model-value="hotspotsForPicture(pic.id)"
                                    :languages="sortedLanguages" :source-lang="form.sourceLang" :readonly="!isEditable"
                                    @update:model-value="onHotspotsUpdated(pic.id, $event)" />
                            </div>
                            <div class="col-auto">
                                <q-btn v-if="isEditable" flat round icon="delete" color="negative" size="sm"
                                    :title="t('button.remove')" @click="onRemovePicture(pic.id)" />
                            </div>
                        </div>
                    </q-tab-panel>
                </q-tab-panels>
            </div>
            <div v-else-if="!isEditable" class="text-caption text-grey-6 q-mt-sm">
                {{ t('input_labels.no_data') }}
            </div>

            <!-- 8. Send-to-translation toggle -->
            <q-separator class="q-my-md" />
            <div class="row items-center q-mt-md">
                <div class="col-auto" style="min-width: 220px">
                    <HelpLabel :field-label="t('translation_states.translatable')"
                        :help-label="t('help.send_to_translation')" />
                    <div class="text-caption text-grey-6 q-mt-xs">
                        {{ form.status === 'APPROVED' ? t('help.source_frozen') : t('help.source_editable') }}
                    </div>
                </div>
                <div class="col-auto q-pt-xs">
                    <q-toggle :model-value="form.status === 'APPROVED'" color="accent"
                        :disable="form.status === 'PUBLISHED'" @update:model-value="onTranslatableToggle" />
                </div>
            </div>

            <!-- 9. Version history -->
            <div v-if="!isNew && form.revisions.length > 0" class="version-history q-mt-md q-mb-md">
                <div class="text-caption text-grey-7 q-mb-xs version-history__label">
                    {{ t('input_labels.version_history') }}
                </div>
                <div class="row q-gutter-xs flex-wrap">
                    <q-chip v-for="rev in form.revisions" :key="rev.revisionNo" dense
                        :color="revisionChipColor(rev.status)" text-color="white"
                        :icon="rev.status === 'PUBLISHED' ? 'check_circle' : rev.status === 'ARCHIVED' ? 'archive' : rev.status === 'APPROVED' ? 'lock' : 'edit'"
                        class="version-chip">
                        <span class="version-chip__label">
                            v{{ rev.revisionNo }}
                            <q-tooltip max-width="240px" anchor="top middle" self="bottom middle">
                                <div class="text-caption">
                                    <div>{{ statusLabelForRevision(rev.status) }}</div>
                                    <div v-if="rev.createdByName">{{ t('input_labels.by') }}: {{ rev.createdByName }}
                                    </div>
                                    <div v-if="rev.publishedAt">{{ t('input_labels.published') }}: {{
                                        formatRevDate(rev.publishedAt) }}</div>
                                    <div v-else-if="rev.createdAt">{{ t('input_labels.created') }}: {{
                                        formatRevDate(rev.createdAt) }}</div>
                                </div>
                            </q-tooltip>
                        </span>
                    </q-chip>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="row q-gutter-sm q-mt-md">
                <q-btn data-cy="canceldoctype" no-caps class="delete-button" unelevated rounded
                    :label="t('button.cancel')" @click="closeForm" />
                <q-btn data-cy="savedoctype" no-caps color="accent" unelevated rounded :label="t('button.save')"
                    :disable="formLoading || form.status === 'PUBLISHED'" :loading="store.loading"
                    @click="() => { void onSave(); }" />
            </div>
        </q-card>

        <!-- ════════════════════════════════════════════════════════════════════
             LIST
             ════════════════════════════════════════════════════════════════════ -->
        <q-item class="q-pb-xs list-header">
            <q-item-section style="min-width:56px; max-width:56px">{{ t('input_labels.image') }}</q-item-section>
            <q-item-section>{{ t('input_labels.name') }}</q-item-section>
            <q-item-section style="min-width:100px; max-width:100px" class="flex flex-center">{{
                t('input_labels.is_published')
            }}</q-item-section>
            <q-item-section style="min-width:120px; max-width:130px" class="flex flex-center">{{
                t('input_labels.transl_state')
            }}</q-item-section>
            <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">{{ t('input_labels.edit')
            }}</q-item-section>
            <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">{{ t('button.delete')
            }}</q-item-section>
        </q-item>

        <q-list bordered separator>
            <template v-for="dt in store.documentTypes" :key="dt.id">
                <q-item class="list-row">
                    <q-item-section style="min-width:56px; max-width:56px; padding-right:8px">
                        <q-img v-if="documentTypeIcon(dt)" :src="documentTypeIcon(dt)"
                            style="width:48px;height:48px;object-fit:contain;border-radius:4px" />
                        <div v-else class="icon-placeholder" />
                    </q-item-section>

                    <q-item-section>
                        <q-item-label class="text-weight-medium">{{ dt.document }}</q-item-label>
                        <q-item-label caption class="row items-center q-gutter-x-xs q-mt-xs">
                            <span class="text-grey-7">{{ t('input_labels.available_transl') }}</span>
                            <q-chip dense color="grey-4" text-color="white" size="sm" class="q-ma-none lang-chip"
                                :label="dt.sourceLang.toUpperCase()" />
                        </q-item-label>
                    </q-item-section>

                    <q-item-section style="min-width:100px; max-width:100px" class="flex flex-center">
                        <q-toggle :model-value="dt.status === 'PUBLISHED'" color="accent"
                            :disable="dt.status === 'DRAFT'" @update:model-value="onPublishedToggle($event, dt)" />
                    </q-item-section>

                    <q-item-section style="min-width:120px; max-width:130px" class="flex flex-center">
                        <q-badge :color="statusBadgeColor(dt.status)" :label="t(documentTypeStatusKey(dt))"
                            class="status-pill" />
                    </q-item-section>

                    <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">
                        <q-btn :data-cy="`editdoc${dt.id}`" flat round icon="edit" size="sm" color="orange"
                            @click="onEditRowClick(dt)" />
                    </q-item-section>

                    <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">
                        <q-btn :data-cy="`deletedoc${dt.id}`" flat round icon="delete" size="sm" color="negative"
                            @click="onDeleteRowClick(dt)" />
                    </q-item-section>
                </q-item>
            </template>

            <q-item v-if="store.loading && store.documentTypes.length === 0">
                <q-item-section class="flex flex-center q-py-md">
                    <q-spinner color="accent" size="32px" />
                </q-item-section>
            </q-item>
            <q-item v-else-if="!store.loading && store.documentTypes.length === 0">
                <q-item-section class="text-grey-6 text-center q-py-md">
                    {{ t('input_labels.no_data') }}
                </q-item-section>
            </q-item>
        </q-list>

        <!-- Import confirm dialog -->
        <q-dialog v-model="importDialogOpen">
            <q-card class="q-pa-md" style="width:700px;max-width:80vw;padding-top:0">
                <div class="q-pt-lg text-center">
                    <p class="text-grey-7">{{ t('input_labels.import') }}</p>
                    <p v-if="importPayload" class="text-weight-bold">
                        {{ importPayload.translations?.[importPayload.sourceLang ?? 'it']?.title ?? '(no title)' }}
                    </p>
                </div>
                <div class="row justify-center q-gutter-md q-pb-md">
                    <q-btn class="edit_button" :label="t('button.import')" icon="upload" rounded unelevated no-caps
                        @click="() => { void onImportConfirmed(); }" />
                    <q-btn class="delete_button" :label="t('button.cancel')" icon="close" rounded unelevated no-caps
                        @click="importDialogOpen = false" />
                </div>
            </q-card>
        </q-dialog>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { v4 as uuidv4 } from 'uuid';
import HelpLabel from 'src/components/HelpLabel.vue';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import PictureHotspotEditor from 'src/components/settings/PictureHotspotEditor.vue';
import { useDocumentTypeStore } from 'src/stores/document-type-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { getRuntimeConfigOrDefaults } from 'src/config/env';
import { documentTypeStatusKey, documentTypeIcon } from 'src/api/document-type.api';
import type {
    DocumentType, DocumentTypeStatus, DocumentTypeFull,
    DocumentTypeDataExtra,
    DocumentHotspot, DocumentPicture, RevisionSummary, TenantOption,
} from 'src/api/document-type.api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useDocumentTypeStore();
const langStore = useLanguageStore();
const app = useAppStore();
const titleLimit = getRuntimeConfigOrDefaults().titleLimit ?? 50;

// ── Constants ──────────────────────────────────────────────────────────────────
const ICON_MAX_BYTES = 500 * 1024;
const MODEL_MAX_BYTES = 5 * 1024 * 1024;
const PICTURE_MAX_BYTES = 2 * 1024 * 1024;
const iconMaxKb = Math.round(ICON_MAX_BYTES / 1024);
const modelMaxKb = Math.round(MODEL_MAX_BYTES / 1024);

// ── Refs ───────────────────────────────────────────────────────────────────────
const importInputRef = ref<HTMLInputElement | null>(null);
const iconFileRef = ref<File | null>(null);
const modelFileRef = ref<File | null>(null);
const pictureFileRef = ref<File | null>(null);
const iconSizeError = ref<string | null>(null);
const modelSizeError = ref<string | null>(null);
const formLoading = ref(false);
const activePictureTab = ref<string>('');
const mlTabsRef = ref<InstanceType<typeof MultiLangEditorTabs> | null>(null);

// ── Form state ─────────────────────────────────────────────────────────────────
interface FormState {
    id: number;
    status: DocumentTypeStatus;
    sourceLang: string;
    iconPreview: string;
    issuer: string;
    modelTemplate: string | null;
    validable: boolean;
    validityDuration: number | null;
    validatorIds: string[];
    pictures: DocumentPicture[];
    hotspots: DocumentHotspot[];
    translations: Record<string, { title?: string; description: string }>;
    revisions: RevisionSummary[];
}

const formOpen = ref(false);
const isNew = ref(false);

function blankForm(): FormState {
    const src = app.defaultLang || 'it';
    return {
        id: -1, status: 'DRAFT', sourceLang: src,
        iconPreview: '', issuer: '', modelTemplate: null,
        validable: false, validityDuration: null,
        validatorIds: [], pictures: [], hotspots: [],
        translations: { [src]: { title: '', description: '' } },
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());
const isEditable = computed(() => form.value.status !== 'PUBLISHED');

const sortedLanguages = computed(() => {
    const src = form.value.sourceLang;
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

// ── Hotspot helpers ────────────────────────────────────────────────────────────
function hotspotsForPicture(pictureId: string): DocumentHotspot[] {
    return form.value.hotspots.filter(h => h.pictureId === pictureId);
}

function onHotspotsUpdated(pictureId: string, updated: DocumentHotspot[]): void {
    const others = form.value.hotspots.filter(h => h.pictureId !== pictureId);
    form.value.hotspots = [...others, ...updated];
}

// ── Picture management ─────────────────────────────────────────────────────────
function onPictureSelected(file: File | File[] | null): void {
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;
    if (f.size > PICTURE_MAX_BYTES) {
        $q.notify({
            color: 'negative', message: t('warning.icon_too_large', {
                fileSize: Math.round(f.size / 1024),
                maxSize: Math.round(PICTURE_MAX_BYTES / 1024),
            })
        });
        pictureFileRef.value = null;
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const pic: DocumentPicture = {
            id: uuidv4(),
            image: reader.result as string,
            order: form.value.pictures.length + 1,
        };
        form.value.pictures = [...form.value.pictures, pic];
        activePictureTab.value = pic.id;
    };
    reader.onerror = () => $q.notify({ color: 'negative', message: t('warning.icon_read_error') });
    reader.readAsDataURL(f);
    pictureFileRef.value = null;
}

function onRemovePicture(pictureId: string): void {
    form.value.pictures = form.value.pictures
        .filter(p => p.id !== pictureId)
        .map((p, i) => ({ ...p, order: i + 1 }));
    form.value.hotspots = form.value.hotspots.filter(h => h.pictureId !== pictureId);
    activePictureTab.value = form.value.pictures[0]?.id ?? '';
}

// ── File uploads ───────────────────────────────────────────────────────────────
function onIconSelected(file: File | File[] | null): void {
    iconSizeError.value = null;
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;
    if (f.size > ICON_MAX_BYTES) {
        iconSizeError.value = t('warning.icon_too_large', { fileSize: Math.round(f.size / 1024), maxSize: iconMaxKb });
        iconFileRef.value = null; return;
    }
    const reader = new FileReader();
    reader.onload = () => { form.value.iconPreview = reader.result as string; };
    reader.onerror = () => { iconSizeError.value = t('warning.icon_read_error'); iconFileRef.value = null; };
    reader.readAsDataURL(f);
}

function onModelSelected(file: File | File[] | null): void {
    modelSizeError.value = null;
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;
    if (f.size > MODEL_MAX_BYTES) {
        modelSizeError.value = t('warning.icon_too_large', { fileSize: Math.round(f.size / 1024), maxSize: modelMaxKb });
        modelFileRef.value = null; return;
    }
    const reader = new FileReader();
    reader.onload = () => { form.value.modelTemplate = reader.result as string; };
    reader.onerror = () => { modelSizeError.value = t('warning.icon_read_error'); modelFileRef.value = null; };
    reader.readAsDataURL(f);
}

// ── Form open / close ──────────────────────────────────────────────────────────
function openNewForm(): void {
    form.value = blankForm();
    isNew.value = true;
    formOpen.value = true;
}

async function openEditForm(dt: DocumentType): Promise<void> {
    form.value = {
        ...blankForm(),
        id: dt.id, status: dt.status, sourceLang: dt.sourceLang,
        iconPreview: dt.dataExtra?.icon ?? '',
        issuer: dt.dataExtra?.issuer ?? '',
        modelTemplate: dt.dataExtra?.model_template ?? null,
        validable: dt.dataExtra?.validable ?? false,
        validityDuration: dt.dataExtra?.validity_duration ?? null,
        translations: { [dt.sourceLang]: { title: dt.document, description: dt.description } },
    };
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    const full = await store.getOne(dt.id);
    formLoading.value = false;
    if (!full) return;

    form.value.status = full.status ?? dt.status;
    form.value.sourceLang = full.sourceLang ?? dt.sourceLang;
    form.value.revisions = full.revisions ?? [];
    form.value.iconPreview = full.dataExtra?.icon ?? dt.dataExtra?.icon ?? '';
    form.value.issuer = full.dataExtra?.issuer ?? '';
    form.value.modelTemplate = full.dataExtra?.model_template ?? null;
    form.value.validable = full.dataExtra?.validable ?? false;
    form.value.validityDuration = full.dataExtra?.validity_duration ?? null;
    form.value.pictures = full.dataExtra?.pictures ?? [];
    form.value.hotspots = full.hotspots ?? [];
    form.value.validatorIds = full.validatorIds ?? [];
    activePictureTab.value = form.value.pictures[0]?.id ?? '';

    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description };
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: dt.document, description: dt.description };
    }
    form.value.translations = tabs;

    logger.info('[DocumentTypesPage] form loaded', {
        id: dt.id, langs: Object.keys(tabs),
        pictures: form.value.pictures.length, hotspots: form.value.hotspots.length,
    });
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
    iconSizeError.value = null;
    modelSizeError.value = null;
}

function onTranslatableToggle(value: boolean): void {
    if (form.value.status === 'PUBLISHED') return;
    form.value.status = value ? 'APPROVED' : 'DRAFT';
}

// ── Row actions ────────────────────────────────────────────────────────────────
function onEditRowClick(dt: DocumentType): void {
    if (dt.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') }); return;
    }
    void openEditForm(dt);
}

function onDeleteRowClick(dt: DocumentType): void {
    $q.notify({
        type: 'warning', timeout: 0,
        message: t('warning.delete_doc_type'),
        actions: [
            { label: t('button.delete'), color: 'red', handler: () => { void store.remove(dt.id); } },
            { label: t('button.back'), color: 'accent', handler: () => { } },
        ],
    });
}

function onPublishedToggle(newValue: boolean, dt: DocumentType): void {
    if (newValue) { void store.publish(dt.id); }
    else { void store.unpublish(dt.id); }
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function onSave(): Promise<void> {
    const latestTranslations = mlTabsRef.value?.getAllTranslations() ?? form.value.translations;

    if (mlTabsRef.value?.hasAnyError()) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') }); return;
    }
    const srcLang = form.value.sourceLang;
    if (!(latestTranslations[srcLang]?.title?.trim())) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') }); return;
    }

    const translationEntries = Object.entries(latestTranslations)
        .filter(([lang, entry]) => {
            if (lang === srcLang) return true;
            return (entry.title?.trim() ?? '') !== '' || (entry.description?.trim() ?? '') !== '';
        })
        .map(([lang, entry]) => [lang, { title: entry.title?.trim() ?? '', description: entry.description ?? '' }]);

    const dataExtra: DocumentTypeDataExtra = {
        validable: form.value.validable,
        model_template: form.value.modelTemplate ?? null,
        validity_duration: form.value.validityDuration ?? null,
        pictures: form.value.pictures,
        ...(form.value.iconPreview ? { icon: form.value.iconPreview } : {}),
        ...(form.value.issuer ? { issuer: form.value.issuer } : {}),
    };

    // Mirror the same empty-translation filter applied to document translations:
    // strip hotspot translation entries where both title and message are blank,
    // unless the lang is sourceLang (always kept so the backend has something to save).
    const cleanedHotspots: DocumentHotspot[] = form.value.hotspots.map(h => ({
        ...h,
        translations: Object.fromEntries(
            Object.entries(h.translations ?? {}).filter(([lang, tr]) => {
                if (lang === srcLang) return true;
                return (tr.title?.trim() ?? '') !== '' || (tr.message?.trim() ?? '') !== '';
            }),
        ),
    }));

    const full: DocumentTypeFull = {
        status: form.value.status,
        sourceLang: srcLang,
        dataExtra,
        translations: Object.fromEntries(translationEntries),
        hotspots: cleanedHotspots,
        validatorIds: form.value.validable ? form.value.validatorIds : [],
    };

    if (isNew.value) {
        const srcTitle = latestTranslations[srcLang]?.title?.trim() ?? '';
        const created = await store.create({
            document: srcTitle,
            description: latestTranslations[srcLang]?.description ?? '',
            status: form.value.status,
            sourceLang: srcLang,
            dataExtra,
            ...(full.translations !== undefined && { translations: full.translations }),
        });
        if (!created || store.error) return;
    } else {
        full.id = form.value.id;
        const ok = await store.save(form.value.id, full);
        if (!ok || store.error) return;
    }
    closeForm();
}

// ── Status helpers ─────────────────────────────────────────────────────────────
function statusBadgeColor(status: DocumentTypeStatus): string {
    switch (status) {
        case 'PUBLISHED': return 'positive';
        case 'APPROVED': return 'info';
        case 'ARCHIVED': return 'grey';
        default: return 'warning';
    }
}

function revisionChipColor(status: RevisionSummary['status']): string {
    switch (status) {
        case 'PUBLISHED': return 'positive';
        case 'APPROVED': return 'info';
        case 'ARCHIVED': return 'grey-5';
        default: return 'warning';
    }
}

function statusLabelForRevision(status: RevisionSummary['status']): string {
    switch (status) {
        case 'PUBLISHED': return t('translation_states.translated');
        case 'APPROVED': return t('translation_states.translatable');
        case 'ARCHIVED': return t('input_labels.archived') ?? 'Archived';
        default: return t('translation_states.editing');
    }
}

function formatRevDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
}

// ── Import ─────────────────────────────────────────────────────────────────────
const importDialogOpen = ref(false);
const importPayload = ref<DocumentTypeFull | null>(null);

function onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            importPayload.value = JSON.parse(e.target?.result as string) as DocumentTypeFull;
            importDialogOpen.value = true;
        } catch { $q.notify({ color: 'negative', message: 'Invalid JSON file.' }); }
    };
    reader.readAsText(file);
    input.value = '';
}

async function onImportConfirmed(): Promise<void> {
    importDialogOpen.value = false;
    const payload = importPayload.value;
    if (!payload) return;
    const srcLang = payload.sourceLang ?? app.defaultLang ?? 'it';
    const srcTr = payload.translations?.[srcLang];
    await store.create({
        document: srcTr?.title ?? '',
        description: srcTr?.description ?? '',
        status: 'DRAFT',
        sourceLang: srcLang,
        dataExtra: { validable: false, ...(payload.dataExtra ?? {}), pictures: payload.dataExtra?.pictures ?? [] },
        translations: Object.fromEntries(
            Object.entries(payload.translations ?? {}).map(([lang, entry]) => [
                lang, { title: entry.title, description: entry.description },
            ]),
        ),
    });
    importPayload.value = null;
}

// ── Init ───────────────────────────────────────────────────────────────────────
onMounted(async () => {
    void store.fetchAll();
    void store.fetchTenants();
    if (langStore.languages.length === 0) {
        await langStore.fetchAll({ active: true });
    }
});
</script>

<style scoped>
h5 {
    font-weight: bold;
}

.status-pill {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
}

.list-row {
    padding-top: 10px !important;
    padding-bottom: 10px !important;
}

.list-header {
    min-height: 32px !important;
    font-size: 11px;
    color: #9e9e9e;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
}

.icon-placeholder {
    width: 48px;
    height: 48px;
    background-color: #e0e0e0;
    border-radius: 4px;
}

.lang-chip {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
}

.version-history {
    &__label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}

.version-chip {
    cursor: default;

    &__label {
        font-size: 11px;
        font-weight: 600;
    }
}

.delete-button {
    background-color: white;
    color: black;
    border: 1px solid #c71f40;
    width: 100px;
    border-radius: 2px;
    margin-right: 15px;
}

.edit_button {
    width: 200px;
    background: #ffffff;
    border: 1px solid #ff7c44;
    box-sizing: border-box;
    border-radius: 5px;
    font-weight: 700;
}

.delete_button {
    width: 200px;
    background: #ffffff;
    border: 1px solid #9e1f63;
    box-sizing: border-box;
    border-radius: 5px;
    font-weight: 700;
}
</style>