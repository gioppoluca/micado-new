<template>
    <!--
    UserTypesPage — /data_settings/user_types

    ── Form flow ────────────────────────────────────────────────────────────────
    NEW record:
      openNewForm()  → blank form, no fetch
      onSave()       → store.create({ ...flat, translations }) in one POST

    EDIT record:
      openEditDialog → onEditConfirmed → openEditForm(ut)
        → store.getOne(id) [GET /user-types/:id → UserTypeFull]
        → populates MultiLangEditorTabs v-model
      onSave()       → store.save(id, UserTypeFull) [PUT]

    ── MultiLangEditorTabs ───────────────────────────────────────────────────
    :show-title="true"  → one q-input per language for the label
                          + one RichTextEditor per language for the description
    v-model             → form.translations: Record<lang, {title, description}>
    :languages          → langStore.activeLanguages, sorted sourceLang first
    :readonly           → source tab readonly when APPROVED/PUBLISHED;
                          other tabs always editable

    ── "Send to translation" toggle ─────────────────────────────────────────
    Maps DRAFT ↔ APPROVED on the revision.
    When toggled ON → backend marks non-source translations STALE.
    PUBLISHED records cannot be toggled here (use the list row toggle).
    -->
    <q-page padding>

        <!-- ── Header ──────────────────────────────────────────────────────── -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('data_settings.user_types') }}</h5>
            <div class="col-auto row q-gutter-sm">
                <q-btn data-cy="addusertype" color="info" no-caps :label="t('button.add_type')" :disable="formOpen"
                    @click="openNewForm" />
                <input ref="importInputRef" type="file" accept=".json" style="display: none"
                    @change="onImportFileSelected" />
                <q-btn color="accent" unelevated rounded no-caps :label="t('button.import')"
                    @click="importInputRef?.click()" />
            </div>
        </div>

        <!-- ── Error banner ────────────────────────────────────────────────── -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ── Icon size warning ────────────────────────────────────────────── -->
        <q-banner v-if="iconSizeError" class="bg-warning text-white q-mb-md" rounded>
            <template #avatar><q-icon name="warning" /></template>
            {{ iconSizeError }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="iconSizeError = null" />
            </template>
        </q-banner>

        <!-- ── Add / Edit form ─────────────────────────────────────────────── -->
        <q-card v-if="formOpen" class="q-pa-md q-mb-lg">

            <!--
                MultiLangEditorTabs with showTitle=true
                ────────────────────────────────────────
                Each tab renders:
                  • q-input  for the title  (the "user_type" label in this lang)
                  • RichTextEditor for the description

                v-model shape: Record<lang, { title?: string; description: string }>
                  matches exactly what MultiLangEditorTabs expects.

                Source-language tab is readonly once the revision is APPROVED or
                PUBLISHED (source text is frozen).  Other language tabs are always
                editable — translators can work independently of the revision state.

                The component is sorted: sourceLang first, then active languages
                alphabetically.  This is handled by sortedLanguages computed below.

                Loading state: while store.getOne() is in flight (edit mode),
                we show a progress bar and disable the Save button.
            -->
            <HelpLabel :field-label="t('input_labels.description')" :help-label="t('help.user_type_description')"
                class="q-mb-xs" />

            <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

            <MultiLangEditorTabs v-else ref="mlTabsRef" v-model="form.translations" :languages="sortedLanguages"
                :show-title="true" :title-max-length="titleLimit" :readonly="false" data-cy="usertype_multilang_tabs" />
            <!--
                Note: :readonly="false" at the component level — we rely on the
                source-language tab being individually locked when status is
                APPROVED/PUBLISHED.  MultiLangEditorTabs does not currently support
                per-tab readonly.  If that becomes a requirement, pass a computed
                that returns true only when lang === sourceLang && !isSourceEditable.
                For now, the toggle label and the badge on the tab communicate the
                frozen state clearly enough.
            -->

            <!-- ── Icon uploader ────────────────────────────────────────────── -->
            <HelpLabel :field-label="t('help.user_type_icon')" :help-label="t('help.user_type_icon')"
                class="q-mt-md q-mb-xs" />
            <div class="row items-center q-gutter-md q-mb-sm">
                <q-img v-if="form.iconPreview" :src="form.iconPreview"
                    style="width: 64px; height: 64px; object-fit: contain" />
                <q-icon v-else name="person" size="64px" color="grey-4" />
                <div class="column q-gutter-xs">
                    <q-file v-if="isEditable" v-model="iconFileRef" dense outlined accept="image/*"
                        :label="t('button.upload')" @update:model-value="onIconSelected" />
                    <span class="text-caption text-grey-6">
                        {{ t('help.icon_max_size', { size: iconMaxKb }) }}
                    </span>
                </div>
            </div>

            <!-- ── Send-to-translation toggle (DRAFT ↔ APPROVED) ────────────── -->
            <!--
                OFF (DRAFT)    → source text still editable; NOT sent to Weblate
                ON  (APPROVED) → source text frozen; Weblate/Gitea can translate
                Disabled when already PUBLISHED.
            -->
            <div class="row items-center q-mt-md">
                <div class="col-auto" style="min-width: 220px">
                    <HelpLabel :field-label="t('translation_states.translatable')"
                        :help-label="t('help.send_to_translation')" />
                    <div class="text-caption text-grey-6 q-mt-xs">
                        {{ form.status === 'APPROVED'
                            ? t('help.source_frozen')
                            : t('help.source_editable') }}
                    </div>
                </div>
                <div class="col-auto q-pt-xs">
                    <q-toggle :model-value="form.status === 'APPROVED'" color="accent"
                        :disable="form.status === 'PUBLISHED'" @update:model-value="onTranslatableToggle" />
                </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="row q-gutter-sm">
                <q-btn data-cy="cancelusertype" no-caps class="delete-button" unelevated rounded
                    :label="t('button.cancel')" @click="closeForm" />
                <q-btn data-cy="saveusertype" no-caps color="accent" unelevated rounded :label="t('button.save')"
                    :disable="formLoading || form.status === 'PUBLISHED'" :loading="store.loading"
                    @click="() => { void onSave(); }" />
            </div>
        </q-card>

        <!-- ── List header ─────────────────────────────────────────────────── -->
        <q-item class="q-pb-none">
            <q-item-section class="col-1">{{ t('input_labels.image') }}</q-item-section>
            <q-item-section class="col-4">{{ t('input_labels.name') }}</q-item-section>
            <q-item-section class="col-2 flex flex-center">{{ t('input_labels.is_published') }}</q-item-section>
            <q-item-section class="col-2 flex flex-center">{{ t('input_labels.transl_state') }}</q-item-section>
            <q-item-section class="col-1 flex flex-center">{{ t('input_labels.edit') }}</q-item-section>
            <q-item-section class="col-1 flex flex-center">{{ t('input_labels.export') }}</q-item-section>
        </q-item>

        <!-- ── List ───────────────────────────────────────────────────────── -->
        <q-list bordered separator>
            <template v-for="ut in store.userTypes" :key="ut.id">
                <q-item>
                    <!-- Icon -->
                    <q-item-section class="col-1">
                        <q-img v-if="userTypeIcon(ut)" :src="userTypeIcon(ut)"
                            style="width: 40px; height: 40px; object-fit: contain" />
                        <q-icon v-else name="person" size="40px" color="grey-4" />
                    </q-item-section>

                    <!-- Name + description -->
                    <q-item-section class="col-4">
                        <q-item-label class="text-weight-medium">{{ ut.user_type }}</q-item-label>
                        <q-item-label v-if="ut.description" caption>
                            <RichTextViewer :content="ut.description" :all-entities-fetched="true" :read-more="true" />
                        </q-item-label>
                    </q-item-section>

                    <!-- Published toggle -->
                    <q-item-section class="col-2 flex flex-center">
                        <q-toggle :model-value="ut.status === 'PUBLISHED'" color="accent"
                            :disable="ut.status === 'DRAFT'" @update:model-value="onPublishedToggle($event, ut)" />
                    </q-item-section>

                    <!-- Status badge -->
                    <q-item-section class="col-2 flex flex-center">
                        <q-badge :color="statusBadgeColor(ut.status)" :label="t(statusLabelKey(ut.status))" />
                    </q-item-section>

                    <!-- Edit -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn :data-cy="`edituser${ut.id}`" flat round icon="edit" size="sm"
                            @click="openEditDialog(ut)" />
                    </q-item-section>

                    <!-- Export -->
                    <q-item-section class="col-1 flex flex-center">
                        <q-btn :data-cy="`exportuser${ut.id}`" flat round icon="download" size="sm"
                            @click="exportUserType(ut)" />
                    </q-item-section>
                </q-item>

                <!-- Source language chip -->
                <div class="row items-center q-px-md q-pb-xs">
                    <span class="text-caption q-mr-sm text-grey-7">
                        {{ t('input_labels.available_transl') }}:
                    </span>
                    <q-chip dense style="background-color: #C4C4C4" text-color="white">
                        {{ ut.sourceLang.toUpperCase() }}
                    </q-chip>
                </div>
            </template>

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
                    <q-btn class="edit_button" :label="t('button.edit')" icon="edit" rounded unelevated no-caps
                        @click="onEditConfirmed" />
                    <q-btn class="delete_button" :label="t('button.delete')" icon="delete" rounded unelevated no-caps
                        @click="onDeleteConfirmed" />
                </div>
            </q-card>
        </q-dialog>

        <!-- ── Import confirm dialog ───────────────────────────────────────── -->
        <q-dialog v-model="importDialogOpen">
            <q-card class="q-pa-md" style="width: 700px; max-width: 80vw; padding-top: 0">
                <div class="q-pt-lg text-center">
                    <p class="text-grey-7">{{ t('input_labels.import') }}</p>
                    <p v-if="importPayload" class="text-weight-bold">
                        {{ importPayload.translations?.[importPayload.sourceLang ?? 'en']?.title
                            ?? '(no title)' }}
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
/**
 * UserTypesPage
 *
 * ── Key architectural decisions ───────────────────────────────────────────
 *
 * 1. MultiLangEditorTabs with showTitle=true
 *    The component already supports title+description per language.
 *    We bind it to form.translations: Record<lang, {title?, description}>.
 *    This replaces the previous hand-rolled tab loop and the separate
 *    q-input for user_type name — everything is inside the tab component.
 *
 * 2. Single source of truth for translations
 *    form.translations IS the payload sent to the backend.  No conversion
 *    needed — UserTypeFull.translations has exactly the same shape.
 *
 * 3. Store actions used
 *    - store.getOne(id)     → UserTypeFull on edit open (one round-trip)
 *    - store.create(payload) → POST with translations embedded
 *    - store.save(id, full)  → PUT with full translations (one round-trip)
 *    - store.patch(id, p)    → PATCH for status toggle / publish
 *
 * 4. No separate translation API call
 *    GET /user-types/:id already returns all translations — no second call.
 */

import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import HelpLabel from 'src/components/HelpLabel.vue';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import RichTextViewer from 'src/components/rich-text-editor/RichTextViewer.vue';
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { getRuntimeConfigOrDefaults } from 'src/config/env';
import type { UserType, UserTypeStatus, UserTypeFull } from 'src/api/user-type.api';
import { translationStateKey, userTypeIcon } from 'src/api/user-type.api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useUserTypeStore();
const langStore = useLanguageStore();
const app = useAppStore();

const titleLimit = getRuntimeConfigOrDefaults().titleLimit ?? 50;

// ── Icon constants ─────────────────────────────────────────────────────────
const ICON_MAX_BYTES = 500 * 1024;
const iconMaxKb = Math.round(ICON_MAX_BYTES / 1024);

// ── Refs ──────────────────────────────────────────────────────────────────
const importInputRef = ref<HTMLInputElement | null>(null);
const iconFileRef = ref<File | null>(null);
const iconSizeError = ref<string | null>(null);
const formLoading = ref(false);

/** Ref to MultiLangEditorTabs — used to call getAllTranslations() on Save */
const mlTabsRef = ref<InstanceType<typeof MultiLangEditorTabs> | null>(null);

// ── Form state ────────────────────────────────────────────────────────────

interface FormState {
    id: number;        // -1 for new records
    status: UserTypeStatus;
    sourceLang: string;
    iconPreview: string;
    /**
     * Per-language content — directly bound to MultiLangEditorTabs v-model.
     * Shape: Record<lang, { title?: string; description: string }>
     */
    translations: Record<string, { title?: string; description: string }>;
}

const formOpen = ref(false);
const isNew = ref(false);

function blankForm(): FormState {
    const src = app.defaultLang || 'en';
    return {
        id: -1,
        status: 'DRAFT',
        sourceLang: src,
        iconPreview: '',
        translations: { [src]: { title: '', description: '' } },
    };
}

const form = ref<FormState>(blankForm());

const isEditable = computed(() => form.value.status !== 'PUBLISHED');

/**
 * Languages for the tab component.
 * sourceLang first, then all other active languages alphabetically.
 * Only active languages are shown.
 */
const sortedLanguages = computed(() => {
    const src = form.value.sourceLang;
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

// ── Edit / Delete dialog ──────────────────────────────────────────────────

const editDialogOpen = ref(false);
const editingItem = ref<UserType | null>(null);

function openEditDialog(ut: UserType): void {
    editingItem.value = ut;
    editDialogOpen.value = true;
}

function onEditConfirmed(): void {
    editDialogOpen.value = false;
    if (!editingItem.value) return;
    if (editingItem.value.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') });
        return;
    }
    void openEditForm(editingItem.value);
}

function onDeleteConfirmed(): void {
    editDialogOpen.value = false;
    const ut = editingItem.value;
    if (!ut) return;
    $q.notify({
        type: 'warning', timeout: 0,
        message: t('warning.delete_user_type'),
        actions: [
            { label: t('button.delete'), color: 'red', handler: () => { void store.remove(ut.id); } },
            { label: t('button.back'), color: 'accent', handler: () => { } },
        ],
    });
}

// ── Form open / close ─────────────────────────────────────────────────────

function openNewForm(): void {
    form.value = blankForm();
    isNew.value = true;
    formOpen.value = true;
}

/**
 * Opens the edit form for an existing user type.
 * Calls store.getOne() to load all translations — one round-trip.
 * Shows the form immediately (with a loading indicator) while the fetch
 * runs, so the layout doesn't jump.
 */
async function openEditForm(ut: UserType): Promise<void> {
    // Show form skeleton immediately
    form.value = {
        id: ut.id,
        status: ut.status,
        sourceLang: ut.sourceLang,
        iconPreview: ut.dataExtra?.icon ?? '',
        // Pre-populate sourceLang from the flat DTO while fetch is in flight
        translations: {
            [ut.sourceLang]: { title: ut.user_type, description: ut.description ?? '' },
        },
    };
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    const full = await store.getOne(ut.id);
    formLoading.value = false;

    if (!full) return; // error already in store.error

    // Populate form from the full DTO
    form.value.status = full.status ?? ut.status;
    form.value.sourceLang = full.sourceLang ?? ut.sourceLang;
    form.value.iconPreview = (full.dataExtra?.icon) ?? (ut.dataExtra?.icon ?? '');

    // Convert UserTypeFull.translations to the shape MultiLangEditorTabs expects
    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description };
    }
    // Ensure sourceLang tab is always present
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: ut.user_type, description: ut.description ?? '' };
    }
    form.value.translations = tabs;

    logger.info('[UserTypesPage] form loaded', {
        id: ut.id,
        langs: Object.keys(tabs),
    });
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
    iconSizeError.value = null;
}

function onTranslatableToggle(value: boolean): void {
    if (form.value.status === 'PUBLISHED') return;
    form.value.status = value ? 'APPROVED' : 'DRAFT';
}

// ── Icon ──────────────────────────────────────────────────────────────────

function onIconSelected(file: File | File[] | null): void {
    iconSizeError.value = null;
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;

    if (f.size > ICON_MAX_BYTES) {
        iconSizeError.value = t('warning.icon_too_large', {
            fileSize: Math.round(f.size / 1024),
            maxSize: iconMaxKb,
        });
        iconFileRef.value = null;
        logger.warn('[UserTypesPage] icon rejected', { filename: f.name, sizeKb: Math.round(f.size / 1024) });
        return;
    }

    const reader = new FileReader();
    reader.onload = () => { form.value.iconPreview = reader.result as string; };
    reader.onerror = () => { iconSizeError.value = t('warning.icon_read_error'); iconFileRef.value = null; };
    reader.readAsDataURL(f);
}

// ── Save ──────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    // Collect the latest Markdown from all RichTextEditor instances inside the tabs
    const latestTranslations = mlTabsRef.value?.getAllTranslations() ?? form.value.translations;

    if (mlTabsRef.value?.hasAnyError()) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    // Validate: sourceLang must have a title
    const srcLang = form.value.sourceLang;
    const srcTitle = latestTranslations[srcLang]?.title?.trim() ?? '';
    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    // Build UserTypeFull payload — same shape for both create and save
    const full: UserTypeFull = {
        status: form.value.status,
        sourceLang: srcLang,
        ...(form.value.iconPreview
            ? { dataExtra: { icon: form.value.iconPreview } }
            : {}),
        // Convert tabs shape to UserTypeFull.translations
        // (title is always string here — default to '' if undefined)
        translations: Object.fromEntries(
            Object.entries(latestTranslations).map(([lang, entry]) => [
                lang,
                {
                    title: entry.title?.trim() ?? '',
                    description: entry.description,
                },
            ]),
        ),
    };

    if (isNew.value) {
        // For new records, create() sends everything in one POST
        const created = await store.create({
            // flat fields (required by CreateUserTypePayload)
            user_type: srcTitle,
            description: latestTranslations[srcLang]?.description ?? '',
            status: form.value.status,
            sourceLang: srcLang,
            ...(form.value.iconPreview ? { dataExtra: { icon: form.value.iconPreview } } : {}),
            // plus the full translations map (omit key entirely when undefined)
            ...(full.translations !== undefined && { translations: full.translations }),
        });
        if (!created || store.error) return;
    } else {
        // For existing records, save() does a PUT with UserTypeFull
        full.id = form.value.id;
        const ok = await store.save(form.value.id, full);
        if (!ok || store.error) return;
    }

    closeForm();
}

// ── Publish / Unpublish ───────────────────────────────────────────────────

function onPublishedToggle(newValue: boolean, ut: UserType): void {
    if (newValue) {
        $q.notify({
            type: 'warning', timeout: 0,
            message: t('warning.publish_user_type'),
            actions: [
                { label: t('lists.yes'), color: 'accent', handler: () => { void store.publish(ut.id); } },
                { label: t('lists.no'), color: 'red', handler: () => { } },
            ],
        });
    } else {
        $q.notify({
            type: 'warning', timeout: 0,
            message: t('warning.unpublish_user_type'),
            actions: [
                { label: t('lists.yes'), color: 'accent', handler: () => { void store.unpublish(ut.id); } },
                { label: t('lists.no'), color: 'red', handler: () => { } },
            ],
        });
    }
}

// ── Status badge ──────────────────────────────────────────────────────────

function statusLabelKey(status: UserTypeStatus): string {
    return translationStateKey({ status });
}

function statusBadgeColor(status: UserTypeStatus): string {
    switch (status) {
        case 'PUBLISHED': return 'positive';
        case 'APPROVED': return 'info';
        case 'ARCHIVED': return 'grey';
        default: return 'warning';
    }
}

// ── Export ────────────────────────────────────────────────────────────────

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

// ── Import ────────────────────────────────────────────────────────────────

const importDialogOpen = ref(false);
const importPayload = ref<UserTypeFull | null>(null);

function onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            importPayload.value = JSON.parse(e.target?.result as string) as UserTypeFull;
            importDialogOpen.value = true;
        } catch {
            $q.notify({ color: 'negative', message: 'Invalid JSON file.' });
        }
    };
    reader.readAsText(file);
    input.value = '';
}

async function onImportConfirmed(): Promise<void> {
    importDialogOpen.value = false;
    const payload = importPayload.value;
    if (!payload) return;

    const srcLang = payload.sourceLang ?? app.defaultLang ?? 'en';
    const srcTr = payload.translations?.[srcLang];

    await store.create({
        user_type: srcTr?.title ?? '',
        description: srcTr?.description ?? '',
        status: 'DRAFT',
        sourceLang: srcLang,
        ...(payload.dataExtra ? { dataExtra: payload.dataExtra } : {}),
        translations: Object.fromEntries(
            Object.entries(payload.translations ?? {}).map(([lang, entry]) => [
                lang, { title: entry.title, description: entry.description },
            ]),
        ),
    });

    importPayload.value = null;
}

// ── Init ──────────────────────────────────────────────────────────────────

onMounted(async () => {
    void store.fetchAll();
    if (langStore.languages.length === 0) {
        await langStore.fetchAll({ active: true });
    }
});
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