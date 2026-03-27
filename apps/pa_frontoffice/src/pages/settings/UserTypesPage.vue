<template>
    <!--
    UserTypesPage — /data_settings/user_types

    Migrated from: src/components/data_settings/UserType.vue (legacy Vue 2)

    Key differences from legacy:
      ┌─────────────────────────────────────┬─────────────────────────────────────┐
      │ Legacy                              │ New                                 │
      ├─────────────────────────────────────┼─────────────────────────────────────┤
      │ Vuex storeMappingMixin              │ useUserTypeStore()                  │
      │ GlossaryEditor (HTML)               │ RichTextEditor (Markdown v-model)   │
      │ GlossaryEditorViewer                │ RichTextViewer (reads Markdown)     │
      │ translations[].translationState 0-3 │ status ENUM: DRAFT/APPROVED/…       │
      │ published boolean                   │ status === 'PUBLISHED'              │
      │ top-level icon field                │ dataExtra.icon (base64 / URL)       │
      │ $envconfig.titleLimit               │ getRuntimeConfigOrDefaults()        │
      │ @input on toggles                   │ @update:model-value (Quasar 2)      │
      └─────────────────────────────────────┴─────────────────────────────────────┘
    -->
    <q-page padding>

        <!-- ── Header row ──────────────────────────────────────────────────── -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('data_settings.user_types') }}</h5>
            <div class="col-auto row q-gutter-sm">
                <q-btn
                    data-cy="addusertype"
                    color="info"
                    no-caps
                    :label="t('button.add_type')"
                    :disable="formOpen"
                    @click="openNewForm"
                />
                <!-- Hidden file input — triggered by the Import button -->
                <input
                    ref="importInputRef"
                    type="file"
                    accept=".json"
                    style="display: none"
                    @change="onImportFileSelected"
                />
                <q-btn
                    color="accent"
                    unelevated
                    rounded
                    no-caps
                    :label="t('button.import')"
                    @click="importInputRef?.click()"
                />
            </div>
        </div>

        <!-- ── Error banner ────────────────────────────────────────────────── -->
        <q-banner
            v-if="store.error"
            class="bg-negative text-white q-mb-md"
            rounded
        >
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ── Add / Edit form ─────────────────────────────────────────────── -->
        <q-card v-if="formOpen" class="q-pa-md q-mb-lg">

            <!-- Name -->
            <HelpLabel
                :field-label="t('input_labels.user_type')"
                :help-label="t('help.user_type')"
                class="q-mb-xs"
            />
            <q-input
                ref="nameInputRef"
                v-model="form.user_type"
                outlined
                filled
                dense
                counter
                :maxlength="titleLimit"
                :hint="t('input_labels.required')"
                :rules="[
                    (val: string) => !!val || t('input_labels.required'),
                    (val: string) => val.length <= titleLimit || `Max ${titleLimit} characters`,
                ]"
                :label="t('input_labels.user_type_placeholder')"
                :readonly="!isEditable"
                data-cy="usertype_name_input"
            />

            <!-- Description — RichTextEditor (replaces GlossaryEditor) -->
            <!--
                v-model is a Markdown string, matching the new backend schema.
                The :readonly prop mirrors the legacy behaviour: name + description
                are locked once the record is PUBLISHED.
            -->
            <HelpLabel
                :field-label="t('input_labels.description')"
                :help-label="t('help.user_type_description')"
                class="q-mt-md q-mb-xs"
            />
            <RichTextEditor
                v-model="form.description"
                :readonly="!isEditable"
                data-cy="usertype_desc_input"
            />

            <!-- Icon uploader -->
            <HelpLabel
                :field-label="t('help.user_type_icon')"
                :help-label="t('help.user_type_icon')"
                class="q-mt-md q-mb-xs"
            />
            <div class="row items-center q-gutter-md q-mb-sm">
                <q-img
                    v-if="form.iconPreview"
                    :src="form.iconPreview"
                    style="width: 64px; height: 64px; object-fit: contain"
                />
                <q-icon v-else name="person" size="64px" color="grey-4" />
                <q-file
                    v-if="isEditable"
                    v-model="iconFileRef"
                    dense
                    outlined
                    accept="image/*"
                    :label="t('button.upload')"
                    @update:model-value="onIconSelected"
                />
            </div>

            <!-- Translatable toggle: DRAFT ↔ APPROVED -->
            <!--
                Legacy: translationState 0 (DRAFT) or 1 (APPROVED/translatable).
                New:    status DRAFT or APPROVED.
                A PUBLISHED record cannot be toggled here — it would require unpublish first.
            -->
            <div class="row items-center q-mt-sm">
                <div class="col-auto" style="min-width: 200px">
                    <HelpLabel
                        :field-label="t('translation_states.translatable')"
                        :help-label="t('help.is_published')"
                    />
                </div>
                <div class="col-auto q-pt-xs">
                    <q-toggle
                        :model-value="form.status === 'APPROVED'"
                        color="accent"
                        :disable="form.status === 'PUBLISHED'"
                        @update:model-value="onTranslatableToggle"
                    />
                </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="row q-gutter-sm">
                <q-btn
                    data-cy="cancelusertype"
                    no-caps
                    class="delete-button"
                    unelevated
                    rounded
                    :label="t('button.cancel')"
                    @click="closeForm"
                />
                <q-btn
                    data-cy="saveusertype"
                    no-caps
                    color="accent"
                    unelevated
                    rounded
                    :label="t('button.save')"
                    :disable="form.status === 'PUBLISHED'"
                    :loading="store.loading"
                    @click="() => { void onSave(); }"
                />
            </div>
        </q-card>

        <!-- ── List header ─────────────────────────────────────────────────── -->
        <q-item class="q-pb-none">
            <q-item-section class="col-1">{{ t('input_labels.image') }}</q-item-section>
            <q-item-section class="col-5">{{ t('input_labels.name') }}</q-item-section>
            <q-item-section class="col-2 flex flex-center">{{ t('input_labels.is_published') }}</q-item-section>
            <q-item-section class="col-1 flex flex-center">{{ t('input_labels.transl_state') }}</q-item-section>
            <q-item-section class="col-1 flex flex-center">{{ t('input_labels.edit') }}</q-item-section>
            <q-item-section class="col-1 flex flex-center">{{ t('input_labels.export') }}</q-item-section>
        </q-item>

        <!-- ── List ───────────────────────────────────────────────────────── -->
        <q-list bordered separator>
            <template v-for="ut in store.userTypes" :key="ut.id">

                <q-item>
                    <!-- Icon -->
                    <q-item-section class="col-1">
                        <q-img
                            v-if="userTypeIcon(ut)"
                            :src="userTypeIcon(ut)"
                            style="width: 40px; height: 40px; object-fit: contain"
                        />
                        <q-icon v-else name="person" size="40px" color="grey-4" />
                    </q-item-section>

                    <!-- Name + description preview (RichTextViewer) -->
                    <q-item-section class="col-5">
                        <q-item-label class="text-weight-medium">{{ ut.user_type }}</q-item-label>
                        <q-item-label v-if="ut.description" caption>
                            <!--
                                RichTextViewer replaces GlossaryEditorViewer.
                                The content prop takes the Markdown string stored in `description`.
                                read-more collapses long descriptions in the list.
                            -->
                            <RichTextViewer
                                :content="ut.description"
                                :all-entities-fetched="true"
                                :read-more="true"
                            />
                        </q-item-label>
                    </q-item-section>

                    <!-- Published toggle -->
                    <q-item-section class="col-2 flex flex-center">
                        <q-toggle
                            :model-value="ut.status === 'PUBLISHED'"
                            color="accent"
                            :disable="ut.status === 'DRAFT'"
                            @update:model-value="onPublishedToggle($event, ut)"
                        />
                    </q-item-section>

                    <!-- Translation-state badge -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-badge
                            :color="statusBadgeColor(ut.status)"
                            :label="t(statusLabelKey(ut.status))"
                        />
                    </q-item-section>

                    <!-- Edit -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn
                            :data-cy="`edituser${ut.id}`"
                            flat round icon="edit" size="sm"
                            @click="openEditDialog(ut)"
                        />
                    </q-item-section>

                    <!-- Export -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn
                            :data-cy="`exportuser${ut.id}`"
                            flat round icon="download" size="sm"
                            @click="exportUserType(ut)"
                        />
                    </q-item-section>
                </q-item>

                <!-- Source-language chip row — mirrors legacy "available translations" row -->
                <div class="row items-center q-px-md q-pb-xs">
                    <span class="text-caption q-mr-sm text-grey-7">
                        {{ t('input_labels.available_transl') }}:
                    </span>
                    <q-chip dense style="background-color: #C4C4C4" text-color="white">
                        {{ ut.sourceLang.toUpperCase() }}
                    </q-chip>
                </div>

            </template>

            <!-- Empty / loading state -->
            <q-item v-if="store.loading && store.userTypes.length === 0">
                <q-item-section class="flex flex-center q-py-md">
                    <q-spinner color="accent" size="32px" />
                </q-item-section>
            </q-item>
            <q-item v-else-if="!store.loading && store.userTypes.length === 0">
                <q-item-section class="text-grey-6 text-center q-py-md">
                    {{ t('input_labels.no_data') ?? 'No user types found.' }}
                </q-item-section>
            </q-item>
        </q-list>

        <!-- ── Edit / Delete dialog ─────────────────────────────────────────── -->
        <q-dialog v-model="editDialogOpen">
            <q-card class="q-pa-md" style="width: 700px; max-width: 80vw; padding-top: 0">
                <div class="q-pt-lg text-center">
                    <p class="text-grey-7">{{ t('input_labels.edit_or_delete') }}</p>
                    <p class="text-weight-bold text-h6">{{ editingItem?.user_type }}?</p>
                </div>
                <div class="row justify-center q-gutter-md q-pb-md">
                    <q-btn
                        class="edit_button"
                        :label="t('button.edit')"
                        icon="edit"
                        rounded unelevated no-caps
                        @click="onEditConfirmed"
                    />
                    <q-btn
                        class="delete_button"
                        :label="t('button.delete')"
                        icon="delete"
                        rounded unelevated no-caps
                        @click="onDeleteConfirmed"
                    />
                </div>
            </q-card>
        </q-dialog>

        <!-- ── Import confirm dialog ───────────────────────────────────────── -->
        <q-dialog v-model="importDialogOpen">
            <q-card class="q-pa-md" style="width: 700px; max-width: 80vw; padding-top: 0">
                <div class="q-pt-lg text-center">
                    <p class="text-grey-7">{{ t('input_labels.import') }}</p>
                    <p v-if="importPayload" class="text-weight-bold">
                        {{ importPayload.user_type }}
                    </p>
                </div>
                <div class="row justify-center q-gutter-md q-pb-md">
                    <q-btn
                        class="edit_button"
                        :label="t('button.import')"
                        icon="upload"
                        rounded unelevated no-caps
                        @click="() => { void onImportConfirmed(); }"
                    />
                    <q-btn
                        class="delete_button"
                        :label="t('button.cancel')"
                        icon="close"
                        rounded unelevated no-caps
                        @click="importDialogOpen = false"
                    />
                </div>
            </q-card>
        </q-dialog>

    </q-page>
</template>

<script setup lang="ts">
/**
 * UserTypesPage
 *
 * Full Vue 3 <script setup> migration of the legacy UserType.vue component.
 *
 * Description field:
 *   Uses RichTextEditor (Markdown v-model) instead of the legacy GlossaryEditor
 *   (HTML v-model). The backend stores description as Markdown. In the list view,
 *   RichTextViewer renders the stored Markdown read-only.
 *
 * Data shape:
 *   The backend returns a flat UserTypeLegacy DTO — no nested `translations` array.
 *   `status` ENUM replaces both the legacy numeric `translationState` and `published`.
 *   `dataExtra.icon` carries the icon base64/URL.
 */

import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import HelpLabel from 'src/components/HelpLabel.vue';
import RichTextEditor from 'src/components/RichTextEditor.vue';
import RichTextViewer from 'src/components/rich-text-editor/RichTextViewer.vue';
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useAppStore } from 'src/stores/app-store';
import { getRuntimeConfigOrDefaults } from 'src/config/env';
import type { UserType, UserTypeStatus, CreateUserTypePayload } from 'src/api/user-type.api';
import { translationStateKey, userTypeIcon } from 'src/api/user-type.api';

const { t } = useI18n();
const $q    = useQuasar();
const store = useUserTypeStore();
const app   = useAppStore();

const titleLimit = getRuntimeConfigOrDefaults().titleLimit ?? 50;

// ── Refs ──────────────────────────────────────────────────────────────────────

const importInputRef = ref<HTMLInputElement | null>(null);
// QInput exposes validate() — typed loosely to avoid importing QInput type
const nameInputRef   = ref<{ validate: () => boolean } | null>(null);
const iconFileRef    = ref<File | null>(null);

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
    id: number;           // -1 for new records
    user_type: string;
    /** Markdown string — bound to RichTextEditor v-model */
    description: string;
    status: UserTypeStatus;
    sourceLang: string;
    /** Base64 data-URL or remote URL; stored in dataExtra.icon */
    iconPreview: string;
}

const formOpen = ref(false);
const isNew    = ref(false);

function blankForm(): FormState {
    return {
        id:          -1,
        user_type:   '',
        description: '',
        status:      'DRAFT',
        sourceLang:  app.defaultLang || 'en',
        iconPreview: '',
    };
}

const form = ref<FormState>(blankForm());

/**
 * Form fields are editable only when the record is not yet PUBLISHED.
 * Matches legacy: readonly when `published == true || translationState != 0`.
 */
const isEditable = computed(() => form.value.status !== 'PUBLISHED');

// ── Edit / Delete dialog ──────────────────────────────────────────────────────

const editDialogOpen = ref(false);
const editingItem    = ref<UserType | null>(null);

function openEditDialog(ut: UserType): void {
    editingItem.value    = ut;
    editDialogOpen.value = true;
}

function onEditConfirmed(): void {
    editDialogOpen.value = false;
    if (!editingItem.value) return;
    if (editingItem.value.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') });
        return;
    }
    mergeIntoForm(editingItem.value);
    formOpen.value = true;
    isNew.value    = false;
}

function onDeleteConfirmed(): void {
    editDialogOpen.value = false;
    const ut = editingItem.value;
    if (!ut) return;
    $q.notify({
        type: 'warning',
        timeout: 0,
        message: t('warning.delete_user_type'),
        actions: [
            { label: t('button.delete'), color: 'red',    handler: () => { void store.remove(ut.id); } },
            { label: t('button.back'),   color: 'accent', handler: () => {} },
        ],
    });
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function openNewForm(): void {
    form.value     = blankForm();
    isNew.value    = true;
    formOpen.value = true;
}

function closeForm(): void {
    formOpen.value = false;
    form.value     = blankForm();
}

function mergeIntoForm(ut: UserType): void {
    form.value = {
        id:          ut.id,
        user_type:   ut.user_type,
        description: ut.description ?? '',
        status:      ut.status,
        sourceLang:  ut.sourceLang,
        iconPreview: ut.dataExtra?.icon ?? '',
    };
}

/**
 * Toggle the "Translatable" state: DRAFT ↔ APPROVED.
 * This mirrors the legacy translationState 0→1 toggle in the form.
 * Has no effect when the record is already PUBLISHED.
 */
function onTranslatableToggle(value: boolean): void {
    if (form.value.status === 'PUBLISHED') return;
    form.value.status = value ? 'APPROVED' : 'DRAFT';
}

function onIconSelected(file: File | File[] | null): void {
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { form.value.iconPreview = reader.result as string; };
    reader.readAsDataURL(f);
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    if (nameInputRef.value?.validate() === false) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const payload: CreateUserTypePayload = {
        user_type:   form.value.user_type.trim(),
        description: form.value.description,       // Markdown from RichTextEditor
        status:      form.value.status,
        sourceLang:  form.value.sourceLang || app.defaultLang || 'en',
        dataExtra:   { icon: form.value.iconPreview },
    };

    if (isNew.value) {
        await store.create(payload);
    } else {
        await store.update(form.value.id, payload);
    }

    if (!store.error) closeForm();
}

// ── Publish / Unpublish ───────────────────────────────────────────────────────

function onPublishedToggle(newValue: boolean, ut: UserType): void {
    if (newValue) {
        $q.notify({
            type: 'warning', timeout: 0,
            message: t('warning.publish_user_type'),
            actions: [
                { label: t('lists.yes'), color: 'accent', handler: () => { void store.publish(ut.id); } },
                { label: t('lists.no'),  color: 'red',    handler: () => {} },
            ],
        });
    } else {
        $q.notify({
            type: 'warning', timeout: 0,
            message: t('warning.unpublish_user_type'),
            actions: [
                { label: t('lists.yes'), color: 'accent', handler: () => { void store.unpublish(ut.id); } },
                { label: t('lists.no'),  color: 'red',    handler: () => {} },
            ],
        });
    }
}

// ── Status badge display ──────────────────────────────────────────────────────

function statusLabelKey(status: UserTypeStatus): string {
    return translationStateKey({ status });
}

function statusBadgeColor(status: UserTypeStatus): string {
    switch (status) {
        case 'PUBLISHED': return 'positive';
        case 'APPROVED':  return 'info';
        case 'ARCHIVED':  return 'grey';
        default:          return 'warning';   // DRAFT
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportUserType(ut: UserType): void {
    const filename = `${ut.user_type.replace(/\s+/g, '_')}.json`;
    const href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(ut, null, 4));
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('download', filename);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ── Import ────────────────────────────────────────────────────────────────────

const importDialogOpen = ref(false);
const importPayload    = ref<UserType | null>(null);

function onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.item(0);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            importPayload.value    = JSON.parse(e.target?.result as string) as UserType;
            importDialogOpen.value = true;
        } catch {
            $q.notify({ color: 'negative', message: 'Invalid JSON file.' });
        }
    };
    reader.readAsText(file);
    input.value = ''; // allow re-selecting same file
}

async function onImportConfirmed(): Promise<void> {
    importDialogOpen.value = false;
    const payload = importPayload.value;
    if (!payload) return;
    await store.create({
        user_type:   payload.user_type,
        description: payload.description ?? '',     // preserve Markdown content
        status:      'DRAFT',                       // always import as draft
        sourceLang:  payload.sourceLang ?? app.defaultLang ?? 'en',
        dataExtra:   payload.dataExtra ?? { icon: '' },
    });
    importPayload.value = null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(() => { void store.fetchAll(); });
</script>

<style scoped>
h5 {
    font-weight: bold;
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
