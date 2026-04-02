<template>
    <!--
    GlossaryPage — /data_settings/glossary

    ── Form flow ────────────────────────────────────────────────────────────────
    NEW:  openNewForm() → onSave() → store.create()
    EDIT: onEditRowClick() → openEditForm() → store.getOne() → onSave() → store.save()
    DELETE: onDeleteRowClick() → confirm → store.remove()

    ── CSV Import ───────────────────────────────────────────────────────────────
    1. User clicks Import → file picker opens (accepts .csv)
    2. File is read and parsed client-side via parseCsvRows()
    3. CsvImportDialog shows preview of all rows (valid + invalid)
    4. User confirms → store.bulkImport() processes rows sequentially
    5. Dialog shows final report: N success + list of failed rows
    6. @done → list refreshes
    -->
    <q-page padding>

        <!-- ── Header ──────────────────────────────────────────────────────── -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('glossary.list_title') }}</h5>
            <div class="col-auto row q-gutter-sm">
                <q-btn data-cy="addterm" color="info" no-caps :label="t('button.add_glossary')" :disable="formOpen"
                    @click="openNewForm" />
                <input ref="csvInputRef" type="file" accept=".csv" style="display: none" @change="onCsvFileSelected" />
                <q-btn color="accent" unelevated rounded no-caps :label="t('button.import')"
                    @click="csvInputRef?.click()" />
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

        <!-- ── Add / Edit form ─────────────────────────────────────────────── -->
        <q-card v-if="formOpen" class="q-pa-md q-mb-lg">
            <div v-if="formLoading" class="row justify-center q-py-xl">
                <q-spinner size="2rem" color="accent" />
            </div>

            <template v-else>
                <!-- Send to translation toggle -->
                <div class="row items-center q-mb-md">
                    <HelpLabel class="col" :field-label="t('translation_states.translatable')"
                        :help-label="form.status === 'APPROVED' ? t('help.source_frozen') : t('help.source_editable')" />
                    <q-toggle :model-value="form.status === 'APPROVED'" color="accent"
                        :disable="form.status === 'PUBLISHED'" @update:model-value="onTranslatableToggle" />
                </div>

                <!-- Revision history -->
                <q-expansion-item v-if="form.revisions.length > 0" dense :label="t('input_labels.version_history')"
                    class="q-mb-md text-caption">
                    <q-list dense>
                        <q-item v-for="rev in form.revisions" :key="rev.revisionNo" dense>
                            <q-item-section>
                                <q-item-label caption>
                                    v{{ rev.revisionNo }} — {{ rev.status }}
                                    <span v-if="rev.createdByName"> · {{ rev.createdByName }}</span>
                                    <span v-if="rev.createdAt"> · {{ formatDate(rev.createdAt) }}</span>
                                </q-item-label>
                            </q-item-section>
                            <q-item-section side>
                                <q-icon
                                    :name="rev.status === 'PUBLISHED' ? 'check_circle' : rev.status === 'ARCHIVED' ? 'archive' : rev.status === 'APPROVED' ? 'lock' : 'edit'"
                                    :color="rev.status === 'PUBLISHED' ? 'positive' : rev.status === 'ARCHIVED' ? 'grey' : rev.status === 'APPROVED' ? 'orange' : 'blue-grey'"
                                    size="xs" />
                            </q-item-section>
                        </q-item>
                    </q-list>
                </q-expansion-item>

                <!-- MultiLangEditorTabs: title + Markdown description per language -->
                <MultiLangEditorTabs v-if="sortedLanguages.length > 0" ref="mlTabsRef" v-model="form.translations"
                    :languages="sortedLanguages" show-title :title-max-length="255"
                    :readonly="form.status === 'PUBLISHED'" class="q-mb-md" />

                <!-- Form actions -->
                <div class="row q-gutter-sm q-mt-md">
                    <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.cancel')"
                        @click="closeForm" />
                    <q-space />
                    <q-btn class="save_button" no-caps color="accent" unelevated rounded :label="t('button.save')"
                        :loading="store.loading" @click="onSave" />
                </div>
            </template>
        </q-card>

        <!-- ── List ────────────────────────────────────────────────────────── -->
        <q-inner-loading :showing="store.loading && !formOpen" />

        <q-item class="q-mb-xs">
            <q-item-section class="col-5 text-caption text-grey-7">{{ t('input_labels.name') }}</q-item-section>
            <q-item-section class="col-4 text-caption text-grey-7">{{ t('input_labels.description') }}</q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">{{ t('input_labels.is_published')
                }}</q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">{{ t('input_labels.transl_state')
                }}</q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">{{ t('input_labels.actions')
                }}</q-item-section>
        </q-item>

        <q-list bordered separator>
            <q-item v-for="term in sortedTerms" :key="term.id" class="q-py-sm">

                <!-- Title + lang chip -->
                <q-item-section class="col-5">
                    <q-item-label>{{ term.title }}</q-item-label>
                    <q-item-label caption class="q-mt-xs">
                        <q-chip dense size="xs" color="grey-3" text-color="grey-8">
                            {{ term.sourceLang.toUpperCase() }}
                        </q-chip>
                    </q-item-label>
                </q-item-section>

                <!-- Description preview (plain text, strip Markdown) -->
                <q-item-section class="col-4">
                    <q-item-label class="text-caption text-grey-7"
                        style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
                        {{ stripMarkdown(term.description) }}
                    </q-item-label>
                </q-item-section>

                <!-- Published toggle -->
                <q-item-section class="col-1 text-center">
                    <q-toggle :model-value="term.status === 'PUBLISHED'" color="accent"
                        :disable="term.status === 'DRAFT'" @update:model-value="onPublishedToggle($event, term)" />
                </q-item-section>

                <!-- Status badge -->
                <q-item-section class="col-1 text-center">
                    <q-badge :color="statusColor(term.status)" :label="t(glossaryStatusKey(term))" />
                </q-item-section>

                <!-- Actions -->
                <q-item-section class="col-1 text-center">
                    <div class="row justify-center q-gutter-xs">
                        <q-btn :data-cy="`editterm${term.id}`" flat round icon="edit" size="sm" color="orange"
                            @click="onEditRowClick(term)">
                            <q-tooltip>{{ t('button.edit') }}</q-tooltip>
                        </q-btn>
                        <q-btn :data-cy="`deleteterm${term.id}`" flat round icon="delete" size="sm" color="negative"
                            @click="onDeleteRowClick(term)">
                            <q-tooltip>{{ t('button.delete') }}</q-tooltip>
                        </q-btn>
                    </div>
                </q-item-section>

            </q-item>
        </q-list>

        <!-- ── CSV Import Dialog ────────────────────────────────────────────── -->
        <CsvImportDialog v-model="csvDialogOpen" :rows="csvRows" :import-fn="store.bulkImport" @done="onImportDone" />

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useGlossaryStore } from 'src/stores/glossary-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { useMicadoEntitiesStore } from 'src/stores/micado-entities-store';
import { glossaryStatusKey, parseCsvRows } from 'src/api/glossary.api';
import type { GlossaryTerm, GlossaryFull, RevisionSummary, CsvParseResult } from 'src/api/glossary.api';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import CsvImportDialog from 'src/components/settings/CsvImportDialog.vue';
import HelpLabel from 'src/components/HelpLabel.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useGlossaryStore();
const langStore = useLanguageStore();
const app = useAppStore();
const entitiesStore = useMicadoEntitiesStore();

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
    id: number;
    status: GlossaryTerm['status'];
    sourceLang: string;
    translations: Record<string, { title?: string; description: string }>;
    revisions: RevisionSummary[];
}

const formOpen = ref(false);
const formLoading = ref(false);
const isNew = ref(false);
const mlTabsRef = ref<InstanceType<typeof MultiLangEditorTabs> | null>(null);

function blankForm(): FormState {
    const src = app.defaultLang || 'it';
    return {
        id: -1,
        status: 'DRAFT',
        sourceLang: src,
        translations: { [src]: { title: '', description: '' } },
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());

const sortedLanguages = computed(() => {
    const src = form.value.sourceLang;
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

// Alphabetically sorted terms for list display
const sortedTerms = computed(() =>
    [...store.terms].sort((a, b) => a.title.localeCompare(b.title)),
);

// ─── CSV import ───────────────────────────────────────────────────────────────

const csvInputRef = ref<HTMLInputElement | null>(null);
const csvDialogOpen = ref(false);
const csvRows = ref<CsvParseResult[]>([]);

function onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0]!;
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target?.result as string;
        csvRows.value = parseCsvRows(content, app.defaultLang || 'it');
        csvDialogOpen.value = true;
    };
    reader.onerror = () => {
        $q.notify({ type: 'negative', message: t('warning.icon_read_error') });
    };
    reader.readAsText(file, 'UTF-8');
    input.value = '';
}

async function onImportDone(): Promise<void> {
    // Refresh the list after a bulk import
    await store.fetchAll();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    await Promise.all([
        store.terms.length === 0 ? store.fetchAll() : Promise.resolve(),
        langStore.languages.length === 0 ? langStore.fetchAll() : Promise.resolve(),
    ]);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMarkdown(md: string): string {
    return md
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
        .replace(/#{1,6}\s+/g, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/\n+/g, ' ')
        .trim();
}

function statusColor(status: GlossaryTerm['status']): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'APPROVED' ? 'orange'
            : status === 'ARCHIVED' ? 'grey'
                : 'blue-grey';
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
}

// ─── Form open / close ────────────────────────────────────────────────────────

function openNewForm(): void {
    form.value = blankForm();
    isNew.value = true;
    formOpen.value = true;
}

async function openEditForm(term: GlossaryTerm): Promise<void> {
    form.value = {
        id: term.id,
        status: term.status,
        sourceLang: term.sourceLang,
        translations: {
            [term.sourceLang]: { title: term.title, description: term.description },
        },
        revisions: [],
    };
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    const full = await store.getOne(term.id);
    formLoading.value = false;
    if (!full) return;

    form.value.status = full.status ?? term.status;
    form.value.sourceLang = full.sourceLang ?? term.sourceLang;
    form.value.revisions = full.revisions ?? [];

    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description };
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: term.title, description: term.description };
    }
    form.value.translations = tabs;
    logger.info('[GlossaryPage] form loaded', { id: term.id, langs: Object.keys(tabs) });
}

function closeForm(): void {
    formOpen.value = false;
    formLoading.value = false;
    form.value = blankForm();
}

// ─── Translatable toggle ──────────────────────────────────────────────────────

function onTranslatableToggle(value: boolean): void {
    if (form.value.status === 'PUBLISHED') return;
    form.value.status = value ? 'APPROVED' : 'DRAFT';
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function onEditRowClick(term: GlossaryTerm): void {
    if (term.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') });
        return;
    }
    void openEditForm(term);
}

function onDeleteRowClick(term: GlossaryTerm): void {
    $q.notify({
        type: 'warning', timeout: 0, message: t('warning.delete_topic'),
        actions: [
            {
                label: t('button.delete'), color: 'red',
                handler: () => { void store.remove(term.id); },
            },
            { label: t('button.back'), color: 'accent', handler: () => { } },
        ],
    });
}

function onPublishedToggle(newValue: boolean, term: GlossaryTerm): void {
    if (newValue) void store.publish(term.id);
    else void store.unpublish(term.id);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    const latestTranslations = mlTabsRef.value?.getAllTranslations() ?? form.value.translations;

    if (mlTabsRef.value?.hasAnyError()) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const srcLang = form.value.sourceLang;
    const srcTitle = latestTranslations[srcLang]?.title?.trim() ?? '';
    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    // Filter empty non-source translations — identical pattern to UserTypes/Topics
    const translationEntries = Object.entries(latestTranslations)
        .filter(([lang, entry]) => {
            if (lang === srcLang) return true;
            return (entry.title?.trim() ?? '') !== '' || (entry.description?.trim() ?? '') !== '';
        })
        .map(([lang, entry]) => [
            lang,
            { title: entry.title?.trim() ?? '', description: entry.description ?? '' },
        ]);

    const full: GlossaryFull = {
        status: form.value.status,
        sourceLang: srcLang,
        translations: Object.fromEntries(translationEntries),
    };

    if (isNew.value) {
        const created = await store.create({
            title: srcTitle,
            description: latestTranslations[srcLang]?.description ?? '',
            sourceLang: srcLang,
            ...(full.translations !== undefined && { translations: full.translations }),
        });
        if (!created || store.error) return;
        entitiesStore.invalidateCache(); // mention picker picks up new term on next @
    } else {
        full.id = form.value.id;
        const ok = await store.save(form.value.id, full);
        if (!ok || store.error) return;
        entitiesStore.invalidateCache(); // mention picker picks up updated title on next @
    }

    closeForm();
}
</script>

<style scoped>
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