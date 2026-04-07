<template>
    <!--
    EventCategoriesPage — /data_settings/event_categories
    ════════════════════════════════════════════════════════════════════════

    Manages CATEGORY content items with subtype="event".
    Follows the same inline list + form pattern as UserTypesPage and
    GlossaryPage — no separate routes for new/edit.

    ── Form flow ────────────────────────────────────────────────────────────
    NEW:  openNewForm() → onSave() → store.create({ subtype: 'event', ... })
    EDIT: onEditRowClick() → openEditForm() → store.getOne() → onSave() → store.save()
    DELETE: onDeleteRowClick() → confirm → store.remove()
      409 (category in use) → store.error banner with explanation.

    ── Translatable fields ──────────────────────────────────────────────────
    Only `title` is translatable. The description tab is hidden because
    categories have no description field (the DB column is stored as "").
    MultiLangEditorTabs is used with showTitle=true and the editor hidden.
    -->
    <q-page padding>

        <!-- Header -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('data_settings.event_categories') }}</h5>
            <q-btn data-cy="add_event_category" color="info" no-caps :label="t('button.add_event_category')"
                :disable="formOpen" @click="openNewForm" />
        </div>

        <!-- Error banner -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ── Form ──────────────────────────────────────────────────────── -->
        <q-card v-if="formOpen" class="q-pa-md q-mb-lg">
            <q-linear-progress v-if="formLoading" indeterminate color="accent" class="q-mb-sm" />

            <template v-if="!formLoading">

                <!-- Send to translation toggle -->
                <div class="row items-center q-mb-md">
                    <HelpLabel class="col" :field-label="t('translation_states.translatable')" :help-label="form.status === 'APPROVED'
                        ? t('help.source_frozen')
                        : t('help.source_editable')" />
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
                                <q-icon :name="revIcon(rev.status)" :color="revColor(rev.status)" size="xs" />
                            </q-item-section>
                        </q-item>
                    </q-list>
                </q-expansion-item>

                <!--
                    Title per language.
                    Categories have only a title — we use q-input per language
                    instead of MultiLangEditorTabs (no rich text needed).
                    The source lang tab is always shown first.
                -->
                <div v-for="lang in sortedLanguages" :key="lang.lang" class="q-mb-md">
                    <HelpLabel :field-label="`${t('input_labels.name')} (${lang.lang.toUpperCase()})`" :help-label="lang.lang === form.sourceLang
                        ? t('help.source_editable')
                        : t('help.translation_field')" class="q-mb-xs" />
                    <q-input v-model="form.translations[lang.lang]" outlined dense bg-color="grey-3" :maxlength="255"
                        :readonly="form.status === 'PUBLISHED'"
                        :label="`${t('input_labels.name')} (${lang.lang.toUpperCase()})`"
                        :data-cy="`category_title_${lang.lang}`" />
                </div>

                <!-- Actions -->
                <div class="row q-gutter-sm q-mt-md">
                    <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.cancel')"
                        @click="closeForm" />
                    <q-space />
                    <q-btn class="save_button" no-caps color="accent" unelevated rounded :label="t('button.save')"
                        :loading="store.loading" @click="onSave" />
                </div>
            </template>
        </q-card>

        <!-- ── List ──────────────────────────────────────────────────────── -->
        <q-inner-loading :showing="store.loading && !formOpen" />

        <!-- Column headers -->
        <q-item class="q-mb-xs">
            <q-item-section class="col-6 text-caption text-grey-7">
                {{ t('input_labels.name') }}
            </q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">
                {{ t('input_labels.is_published') }}
            </q-item-section>
            <q-item-section class="col-2 text-caption text-grey-7 text-center">
                {{ t('input_labels.transl_state') }}
            </q-item-section>
            <q-item-section class="col-3 text-caption text-grey-7 text-center">
                {{ t('input_labels.actions') }}
            </q-item-section>
        </q-item>

        <q-list bordered separator>
            <q-item v-for="cat in store.categories" :key="cat.id" class="q-py-sm">

                <!-- Title + lang chip -->
                <q-item-section class="col-6">
                    <q-item-label>{{ cat.title }}</q-item-label>
                    <q-item-label caption class="q-mt-xs">
                        <q-chip dense size="xs" color="grey-3" text-color="grey-8">
                            {{ cat.sourceLang.toUpperCase() }}
                        </q-chip>
                    </q-item-label>
                </q-item-section>

                <!-- Published toggle -->
                <q-item-section class="col-1 text-center">
                    <q-toggle :model-value="cat.status === 'PUBLISHED'" color="accent" :disable="cat.status === 'DRAFT'"
                        @update:model-value="onPublishedToggle($event, cat)" />
                </q-item-section>

                <!-- Status badge -->
                <q-item-section class="col-2 text-center">
                    <q-badge :color="statusColor(cat.status)" :label="t(categoryStatusKey(cat))" />
                </q-item-section>

                <!-- Actions -->
                <q-item-section class="col-3 text-center">
                    <div class="row justify-center q-gutter-xs">
                        <q-btn :data-cy="`edit_category_${cat.id}`" flat round icon="edit" size="sm" color="orange"
                            @click="onEditRowClick(cat)">
                            <q-tooltip>{{ t('button.edit') }}</q-tooltip>
                        </q-btn>
                        <q-btn :data-cy="`delete_category_${cat.id}`" flat round icon="delete" size="sm"
                            color="negative" @click="onDeleteRowClick(cat)">
                            <q-tooltip>{{ t('button.delete') }}</q-tooltip>
                        </q-btn>
                    </div>
                </q-item-section>

            </q-item>

            <!-- Empty state -->
            <q-item v-if="!store.loading && store.categories.length === 0">
                <q-item-section class="text-grey-6 text-caption q-py-md text-center">
                    {{ t('data_settings.no_event_categories') }}
                </q-item-section>
            </q-item>
        </q-list>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useCategoryStore } from 'src/stores/category-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { categoryStatusKey } from 'src/api/category.api';
import type { Category, CategoryFull, RevisionSummary } from 'src/api/category.api';
import HelpLabel from 'src/components/HelpLabel.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useCategoryStore();
const langStore = useLanguageStore();
const app = useAppStore();

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
    id: number;
    status: Category['status'];
    sourceLang: string;
    /** lang → title string (simple, no rich text) */
    translations: Record<string, string>;
    revisions: RevisionSummary[];
}

const formOpen = ref(false);
const formLoading = ref(false);
const isNew = ref(false);

function blankForm(): FormState {
    const src = app.defaultLang || 'it';
    return {
        id: -1,
        status: 'DRAFT',
        sourceLang: src,
        translations: { [src]: '' },
        revisions: [],
    };
}

const form = ref<FormState>(blankForm());

/** Source language first, then others alphabetically. */
const sortedLanguages = computed(() => {
    const src = form.value.sourceLang;
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    await Promise.all([
        store.categories.length === 0 ? store.fetchAll('event') : Promise.resolve(),
        langStore.languages.length === 0 ? langStore.fetchAll() : Promise.resolve(),
    ]);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: Category['status']): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'APPROVED' ? 'orange'
            : status === 'ARCHIVED' ? 'grey'
                : 'blue-grey';
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
}

function revIcon(status: string): string {
    return status === 'PUBLISHED' ? 'check_circle'
        : status === 'ARCHIVED' ? 'archive'
            : status === 'APPROVED' ? 'lock'
                : 'edit';
}

function revColor(status: string): string {
    return status === 'PUBLISHED' ? 'positive'
        : status === 'ARCHIVED' ? 'grey'
            : status === 'APPROVED' ? 'orange'
                : 'blue-grey';
}

// ─── Form open / close ────────────────────────────────────────────────────────

function openNewForm(): void {
    form.value = blankForm();
    // Ensure all active languages have an entry
    for (const l of langStore.activeLanguages) {
        if (!form.value.translations[l.lang]) {
            form.value.translations[l.lang] = '';
        }
    }
    isNew.value = true;
    formOpen.value = true;
}

async function openEditForm(cat: Category): Promise<void> {
    form.value = {
        id: cat.id,
        status: cat.status,
        sourceLang: cat.sourceLang,
        translations: { [cat.sourceLang]: cat.title },
        revisions: [],
    };
    isNew.value = false;
    formOpen.value = true;
    formLoading.value = true;

    const full = await store.getOne(cat.id);
    formLoading.value = false;
    if (!full) return;

    form.value.status = full.status ?? cat.status;
    form.value.sourceLang = full.sourceLang ?? cat.sourceLang;
    form.value.revisions = full.revisions ?? [];

    const tabs: Record<string, string> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = entry.title;
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = cat.title;
    }
    // Ensure all active languages have an entry
    for (const l of langStore.activeLanguages) {
        if (!tabs[l.lang]) tabs[l.lang] = '';
    }
    form.value.translations = tabs;
    logger.info('[EventCategoriesPage] form loaded', {
        id: cat.id, langs: Object.keys(tabs),
    });
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

function onEditRowClick(cat: Category): void {
    if (cat.status === 'PUBLISHED') {
        $q.notify({ color: 'red', message: t('warning.published_edit') });
        return;
    }
    void openEditForm(cat);
}

function onDeleteRowClick(cat: Category): void {
    $q.notify({
        type: 'warning', timeout: 0,
        message: t('warning.delete_event_category'),
        actions: [
            {
                label: t('button.delete'), color: 'red',
                handler: () => {
                    void store.remove(cat.id).then(ok => {
                        if (!ok && store.error) {
                            $q.notify({ type: 'negative', message: store.error });
                            store.clearError();
                        }
                    });
                },
            },
            { label: t('button.back'), color: 'accent', handler: () => { } },
        ],
    });
}

function onPublishedToggle(newValue: boolean, cat: Category): void {
    if (newValue) void store.publish(cat.id);
    else void store.unpublish(cat.id);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
    const srcLang = form.value.sourceLang;
    const srcTitle = (form.value.translations[srcLang] ?? '').trim();

    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    // Build translations map — skip non-source entries that are completely empty
    const translationsMap: Record<string, { title: string }> = {};
    for (const [lang, title] of Object.entries(form.value.translations)) {
        const trimmed = title.trim();
        if (lang === srcLang || trimmed) {
            translationsMap[lang] = { title: trimmed };
        }
    }

    const full: CategoryFull = {
        status: form.value.status,
        sourceLang: srcLang,
        translations: Object.fromEntries(
            Object.entries(translationsMap).map(([l, c]) => [l, { title: c.title }]),
        ),
    };

    if (isNew.value) {
        const created = await store.create({
            title: srcTitle,
            sourceLang: srcLang,
            subtype: 'event',
            translations: translationsMap,
        });
        if (!created || store.error) return;
    } else {
        full.id = form.value.id;
        const ok = await store.save(form.value.id, full);
        if (!ok || store.error) return;
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