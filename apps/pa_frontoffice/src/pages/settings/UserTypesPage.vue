<template>
    <!--
    UserTypesPage — /data_settings/user_types

    ── Form flow ────────────────────────────────────────────────────────────────
    NEW record:
      openNewForm()  → blank form, no fetch
      onSave()       → store.create({ ...flat, translations }) in one POST

    EDIT record:
      onEditRowClick(ut) → openEditForm(ut) directly (no intermediate dialog)
        → store.getOne(id) [GET /user-types/:id → UserTypeFull]
        → populates MultiLangEditorTabs v-model
      onSave()       → store.save(id, UserTypeFull) [PUT]

    DELETE record:
      onDeleteRowClick(ut) → $q.notify confirm → store.remove(ut.id)

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

            <!--
                Version history panel — visible only when editing an existing record.
                Shows all revisions sorted chronologically (oldest first).
                The current working revision is highlighted.
                Read-only: no actions here, just audit visibility.
            -->
            <div v-if="!isNew && form.revisions.length > 0" class="version-history q-mb-md">
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

            <div class="row q-gutter-sm">
                <q-btn data-cy="cancelusertype" no-caps class="delete-button" unelevated rounded
                    :label="t('button.cancel')" @click="closeForm" />
                <q-btn data-cy="saveusertype" no-caps color="accent" unelevated rounded :label="t('button.save')"
                    :disable="formLoading || form.status === 'PUBLISHED'" :loading="store.loading"
                    @click="() => { void onSave(); }" />
            </div>
        </q-card>

        <!-- ── List header — widths mirror the data row sections exactly ────── -->
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

        <!-- ── List ───────────────────────────────────────────────────────── -->
        <q-list bordered separator>
            <template v-for="ut in store.userTypes" :key="ut.id">
                <!--
                    Row height is driven by the two-line Name column content
                    (name + "Available translations" chips), matching Figma Document Types.
                    No description in the list — description is only visible in the edit form.
                    Not dense: rows need natural two-line height (~64-72px).
                -->
                <q-item class="list-row">
                    <!-- Icon: 48px grey placeholder matching Figma -->
                    <q-item-section style="min-width:56px; max-width:56px; padding-right: 8px">
                        <q-img v-if="userTypeIcon(ut)" :src="userTypeIcon(ut)"
                            style="width: 48px; height: 48px; object-fit: contain; border-radius: 4px;" />
                        <div v-else class="icon-placeholder" />
                    </q-item-section>

                    <!--
                        Name column: two lines.
                        Line 1 — name (medium weight).
                        Line 2 — "Available translations" label + lang chips.
                        No description shown here; keeps list compact like Figma.
                    -->
                    <q-item-section>
                        <q-item-label class="text-weight-medium">
                            <span style="cursor: default">
                                {{ ut.user_type }}
                                <q-tooltip v-if="ut.description" anchor="top left" self="bottom left" :offset="[0, 4]"
                                    max-width="320px" class="description-tooltip">{{ stripMarkdown(ut.description)
                                    }}</q-tooltip>
                            </span>
                        </q-item-label>
                        <q-item-label caption class="row items-center q-gutter-x-xs q-mt-xs">
                            <span class="text-grey-7">{{ t('input_labels.available_transl') }}</span>
                            <q-chip v-for="lang in displayLangs(ut)" :key="lang" dense color="grey-4" text-color="white"
                                size="sm" class="q-ma-none lang-chip" :label="lang.toUpperCase()" />
                        </q-item-label>
                    </q-item-section>

                    <!-- Published toggle -->
                    <q-item-section style="min-width:100px; max-width:100px" class="flex flex-center">
                        <q-toggle :model-value="ut.status === 'PUBLISHED'" color="accent"
                            :disable="ut.status === 'DRAFT'" @update:model-value="onPublishedToggle($event, ut)" />
                    </q-item-section>

                    <!-- Translation status pill — kept as pill per preference -->
                    <q-item-section style="min-width:120px; max-width:130px" class="flex flex-center">
                        <q-badge :color="statusBadgeColor(ut.status)" :label="t(statusLabelKey(ut.status))"
                            class="status-pill" />
                    </q-item-section>

                    <!-- Edit: orange pencil, flat, no background circle — matches Figma -->
                    <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">
                        <q-btn :data-cy="`edituser${ut.id}`" flat round icon="edit" size="sm" color="orange"
                            @click="onEditRowClick(ut)" />
                    </q-item-section>

                    <!-- Delete: red trash, flat — matches Figma -->
                    <q-item-section style="min-width:48px; max-width:48px" class="flex flex-center">
                        <q-btn :data-cy="`deleteuser${ut.id}`" flat round icon="delete" size="sm" color="negative"
                            @click="onDeleteRowClick(ut)" />
                    </q-item-section>
                </q-item>
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
import { useUserTypeStore } from 'src/stores/user-type-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { getRuntimeConfigOrDefaults } from 'src/config/env';
import type { UserType, UserTypeStatus, UserTypeFull, RevisionSummary } from 'src/api/user-type.api';
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
    /**
     * Revision history — populated from UserTypeFull.revisions[] on edit open.
     * Empty for new records. Read-only; never sent to the backend.
     */
    revisions: RevisionSummary[];
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
        revisions: [],
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

/**
 * Edit row click — opens the form directly without an intermediate dialog.
 * Matches Figma Document Types layout where edit icon goes straight to the form.
 */
function onEditRowClick(ut: UserType): void {
    if (ut.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') });
        return;
    }
    void openEditForm(ut);
}

/**
 * Delete row click — confirms via $q.notify and deletes directly.
 * No intermediate dialog — matches Figma where delete is a direct column action.
 */
function onDeleteRowClick(ut: UserType): void {
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
        // Empty until getOne() completes — required by FormState
        revisions: [],
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
    form.value.revisions = full.revisions ?? [];
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

    // Build UserTypeFull payload — same shape for both create and save.
    //
    // Non-source language rows with an empty title are excluded from the payload.
    // The backend facade only upserts keys present in body.translations, so omitting
    // a key leaves the existing DB row untouched.
    //
    // Why: the user may open a non-source tab, type a description, then delete it.
    // getAllTranslations() returns { title: '', description: '' } for that lang.
    // Sending title='' to the backend would trigger "title cannot be empty" validation.
    // The correct behaviour is: if a non-source lang has no meaningful content,
    // do not include it in the save payload at all.
    const translationEntries = Object.entries(latestTranslations)
        .filter(([lang, entry]) => {
            if (lang === srcLang) return true;          // source lang always included
            const title = entry.title?.trim() ?? '';
            const desc = entry.description?.trim() ?? '';
            return title !== '' || desc !== '';          // non-source: skip if both empty
        })
        .map(([lang, entry]) => [
            lang,
            {
                title: entry.title?.trim() ?? '',
                description: entry.description ?? '',
            },
        ]);

    const full: UserTypeFull = {
        status: form.value.status,
        sourceLang: srcLang,
        ...(form.value.iconPreview
            ? { dataExtra: { icon: form.value.iconPreview } }
            : {}),
        translations: Object.fromEntries(translationEntries),
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

/**
 * Direct state change — calls the API immediately without a confirm dialog.
 * Toggling ON:  APPROVED → PUBLISHED  (store.publish → GET /to-production)
 * Toggling OFF: PUBLISHED → DRAFT     (store.unpublish → PATCH status=DRAFT)
 *
 * The toggle is disabled for DRAFT items (they need APPROVED first).
 * On API error, store.error is set and the list re-renders with the original status.
 */
function onPublishedToggle(newValue: boolean, ut: UserType): void {
    if (newValue) {
        void store.publish(ut.id);
    } else {
        void store.unpublish(ut.id);
    }
}

/**
 * Strips common Markdown syntax for display in a plain-text tooltip.
 * Removes bold/italic markers, headings, inline code, links and images.
 * Not a full MD parser — just enough for typical short descriptions.
 */
function stripMarkdown(md: string): string {
    return md
        .replace(/!\[.*?\]\(.*?\)/g, '')        // images
        .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')  // links → label only
        .replace(/#{1,6}\s+/g, '')               // headings
        .replace(/(\*\*|__)(.*?)\1/g, '$2')     // bold
        .replace(/(\*|_)(.*?)\1/g, '$2')        // italic
        .replace(/`{1,3}[^`]*`{1,3}/g, '')      // inline code / fenced
        .replace(/^[-*+]\s+/gm, '')             // list bullets
        .replace(/\n{2,}/g, ' · ')              // paragraph breaks → separator
        .replace(/\n/g, ' ')                    // single newlines → space
        .trim();
}

/**
 * Returns the language codes to show as chips in the list row.
 * For the flat UserType list item we only have sourceLang — that's the minimum.
 * Additional languages are only available after getOne() (form open).
 * Shows sourceLang always; shows up to 3 langs if the store somehow carries more.
 */
function displayLangs(ut: UserType): string[] {
    return [ut.sourceLang];
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

// ── Version history helpers ──────────────────────────────────────────────────

/**
 * Chip color per revision status — mirrors statusBadgeColor but for the
 * version history panel which uses a different visual context.
 * PUBLISHED → positive (green)   the live version
 * APPROVED  → info (blue)        frozen, sent to translators
 * DRAFT     → warning (amber)    current working copy
 * ARCHIVED  → grey               superseded, historical record
 */
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
        case 'PUBLISHED': return t('translation_states.translated');   // reuse: "Published"
        case 'APPROVED': return t('translation_states.translatable'); // reuse: "Approved"
        case 'ARCHIVED': return t('input_labels.archived') ?? 'Archived';
        default: return t('translation_states.editing');       // reuse: "Draft"
    }
}

/** Format an ISO timestamp as a short locale date string. */
function formatRevDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    } catch {
        return iso;
    }
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

/* Status pill — slightly more padding than a plain badge for readability */
.status-pill {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
}

/*
 * List rows: natural height driven by two-line name content (~64-72px).
 * Row padding trimmed to match Figma's comfortable but not padded look.
 */
.list-row {
    padding-top: 10px !important;
    padding-bottom: 10px !important;
}

/* List header: smaller, grey, uppercase labels */
.list-header {
    min-height: 32px !important;
    font-size: 11px;
    color: #9e9e9e;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
}

/* 48×48 grey placeholder when no icon uploaded — matches Figma grey square */
.icon-placeholder {
    width: 48px;
    height: 48px;
    background-color: #e0e0e0;
    border-radius: 4px;
}

/* Language chips in the Available translations row */
.lang-chip {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
}

/* Version history chip strip */
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

/* Description tooltip — plain text, comfortable reading width */
.description-tooltip {
    font-size: 13px;
    line-height: 1.5;
    background: rgba(50, 50, 50, 0.92);
    color: #fff;
    border-radius: 6px;
    padding: 6px 10px;
    white-space: normal;
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