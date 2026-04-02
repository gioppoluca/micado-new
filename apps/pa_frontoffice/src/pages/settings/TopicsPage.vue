<template>
    <!--
    TopicsPage — /data_settings/topics

    ── Form flow ────────────────────────────────────────────────────────────────
    NEW:  openNewForm() → onSave() → store.create()
    EDIT: onEditRowClick() → openEditForm() → store.getOne() → onSave() → store.save()
    DELETE: onDeleteRowClick() → confirm → store.remove()
      409 (has children) → error surfaced via store.error banner.

    ── TopicTreeSelect ──────────────────────────────────────────────────────────
    Full hierarchy shown. Nodes at depth >= maxSelectableDepth are visible but
    not selectable. excludeId prevents self-parenting.
    maxSelectableDepth loaded from app_settings 'topic.max_depth'.
    -->
    <q-page padding>

        <!-- Header -->
        <div class="row items-center q-mb-md">
            <h5 class="col q-my-none">{{ t('data_settings.topics') }}</h5>
            <div class="col-auto row q-gutter-sm">
                <q-btn data-cy="addtopic" color="info" no-caps :label="t('button.add_topic')" :disable="formOpen"
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

        <!-- Add / Edit form -->
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

                <!-- MultiLang tabs -->
                <MultiLangEditorTabs v-if="sortedLanguages.length > 0" ref="mlTabsRef" v-model="form.translations"
                    :languages="sortedLanguages" show-title :title-max-length="200"
                    :readonly="form.status === 'PUBLISHED'" class="q-mb-md" />

                <!-- Icon -->
                <HelpLabel :field-label="t('help.topic_icon')" :help-label="t('help.topic_icon')"
                    class="q-mt-md q-mb-xs" />
                <div class="row items-center q-gutter-md q-mb-md">
                    <q-img v-if="form.iconPreview" :src="form.iconPreview"
                        style="width: 64px; height: 64px; object-fit: contain" />
                    <q-icon v-else name="label" size="64px" color="grey-4" />
                    <div class="column q-gutter-xs">
                        <q-file v-if="isEditable" v-model="iconFileRef" dense outlined accept="image/*"
                            :label="t('button.upload')" @update:model-value="onIconSelected" />
                        <span class="text-caption text-grey-6">
                            {{ t('help.icon_max_size', { size: iconMaxKb }) }}
                        </span>
                    </div>
                </div>

                <!-- Parent selector -->
                <HelpLabel :field-label="t('input_labels.parent_topic')" :help-label="t('help.parent_topic')"
                    class="q-mb-xs" />
                <TopicTreeSelect v-model="form.parentId" :topics="store.topics"
                    :max-selectable-depth="maxSelectableDepth" v-bind="isNew ? {} : { excludeId: form.id }"
                    :placeholder="t('input_labels.select_topic')" :disabled="form.status === 'PUBLISHED'"
                    class="q-mb-md" />

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

        <!-- List -->
        <q-inner-loading :showing="store.loading && !formOpen" />

        <q-item class="q-mb-xs">
            <q-item-section class="col-1" />
            <q-item-section class="col-5 text-caption text-grey-7">{{ t('input_labels.name') }}</q-item-section>
            <q-item-section class="col-2 text-caption text-grey-7 text-center">{{ t('input_labels.parent_topic')
                }}</q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">{{ t('input_labels.is_published')
                }}</q-item-section>
            <q-item-section class="col-1 text-caption text-grey-7 text-center">{{ t('input_labels.transl_state')
                }}</q-item-section>
            <q-item-section class="col-2 text-caption text-grey-7 text-center">{{ t('input_labels.actions')
                }}</q-item-section>
        </q-item>

        <q-list bordered separator>
            <q-item v-for="topic in store.topics" :key="topic.id" class="q-py-sm">
                <q-item-section class="col-1">
                    <q-img v-if="topic.dataExtra?.icon" :src="topic.dataExtra.icon"
                        style="width: 40px; height: 40px; object-fit: contain; border-radius: 4px;" />
                    <div v-else class="icon-placeholder" />
                </q-item-section>
                <q-item-section class="col-5">
                    <q-item-label>
                        <span v-if="topic.depth > 0" class="text-grey-5 q-mr-xs">
                            {{ '·'.repeat(topic.depth) }}
                        </span>
                        {{ topic.topic }}
                    </q-item-label>
                    <q-item-label caption class="q-mt-xs">
                        <q-chip v-for="lang in displayLangs(topic)" :key="lang" dense size="xs" color="grey-3"
                            text-color="grey-8">
                            {{ lang.toUpperCase() }}
                        </q-chip>
                    </q-item-label>
                </q-item-section>
                <q-item-section class="col-2 text-center">
                    <span v-if="topic.parentId !== null" class="text-caption text-grey-7">
                        {{ parentLabel(topic.parentId) }}
                    </span>
                    <span v-else class="text-caption text-grey-4">—</span>
                </q-item-section>
                <q-item-section class="col-1 text-center">
                    <q-toggle :model-value="topic.status === 'PUBLISHED'" color="accent"
                        :disable="topic.status === 'DRAFT'" @update:model-value="onPublishedToggle($event, topic)" />
                </q-item-section>
                <q-item-section class="col-1 text-center">
                    <q-badge :color="statusColor(topic.status)" :label="t(topicStatusKey(topic))" />
                </q-item-section>
                <q-item-section class="col-2 text-center">
                    <div class="row justify-center q-gutter-xs">
                        <q-btn :data-cy="`edittopic${topic.id}`" flat round icon="edit" size="sm" color="orange"
                            @click="onEditRowClick(topic)">
                            <q-tooltip>{{ t('button.edit') }}</q-tooltip>
                        </q-btn>
                        <q-btn flat round icon="download" size="sm" color="grey-7" @click="exportTopic(topic)">
                            <q-tooltip>{{ t('button.export') }}</q-tooltip>
                        </q-btn>
                        <q-btn :data-cy="`deletetopic${topic.id}`" flat round icon="delete" size="sm" color="negative"
                            @click="onDeleteRowClick(topic)">
                            <q-tooltip>{{ t('button.delete') }}</q-tooltip>
                        </q-btn>
                    </div>
                </q-item-section>
            </q-item>
        </q-list>

        <!-- Import dialog -->
        <q-dialog v-model="importDialogOpen">
            <q-card class="q-pa-md" style="width: 500px; max-width: 90vw">
                <q-card-section class="text-center">
                    <p class="text-body1">{{ t('input_labels.import') }}</p>
                    <p v-if="importPayload" class="text-caption text-grey-7">
                        {{ importPayload.translations?.[importPayload.sourceLang ?? 'it']?.title ?? '(no title)' }}
                    </p>
                </q-card-section>
                <q-card-actions align="center" class="q-gutter-sm">
                    <q-btn class="edit_button" icon="upload" rounded unelevated no-caps :label="t('button.import')"
                        @click="confirmImport" />
                    <q-btn class="delete_button" icon="close" rounded unelevated no-caps :label="t('button.cancel')"
                        @click="importDialogOpen = false" />
                </q-card-actions>
            </q-card>
        </q-dialog>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useTopicStore } from 'src/stores/topic-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { topicStatusKey } from 'src/api/topic.api';
import type { Topic, TopicFull, TopicTranslation, RevisionSummary } from 'src/api/topic.api';
import { settingsApi } from 'src/api/settings.api';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import TopicTreeSelect from 'src/components/settings/TopicTreeSelect.vue';
import HelpLabel from 'src/components/HelpLabel.vue';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const store = useTopicStore();
const langStore = useLanguageStore();
const app = useAppStore();

const ICON_MAX_BYTES = 500 * 1024;
const iconMaxKb = Math.round(ICON_MAX_BYTES / 1024);
const iconFileRef = ref<File | null>(null);
const iconSizeError = ref<string | null>(null);
const maxSelectableDepth = ref<number>(99);

interface FormState {
    id: number;
    status: Topic['status'];
    sourceLang: string;
    iconPreview: string;
    parentId: number | null;
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
        id: -1, status: 'DRAFT', sourceLang: src,
        iconPreview: '', parentId: null,
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

onMounted(async () => {
    await Promise.all([
        store.topics.length === 0 ? store.fetchAll() : Promise.resolve(),
        langStore.languages.length === 0 ? langStore.fetchAll() : Promise.resolve(),
        loadMaxDepth(),
    ]);
});

async function loadMaxDepth(): Promise<void> {
    try {
        // Use the list endpoint with prefix to avoid a 404 when the setting
        // has not yet been inserted into app_settings. An absent key returns
        // an empty array, not a 404, so the catch block is never triggered
        // and the console stays clean.
        const rows = await settingsApi.list('topic.');
        const row = rows.find(r => r.key === 'topic.max_depth');
        if (row) {
            const parsed = Number(row.value);
            if (Number.isFinite(parsed)) maxSelectableDepth.value = parsed;
        }
    } catch { /* network error — keep default 99 */ }
}

function parentLabel(parentId: number): string {
    return store.topics.find(t => t.id === parentId)?.topic ?? `#${parentId}`;
}
function displayLangs(topic: Topic): string[] { return [topic.sourceLang]; }
function statusColor(status: Topic['status']): string {
    return status === 'PUBLISHED' ? 'positive' : status === 'APPROVED' ? 'orange' : status === 'ARCHIVED' ? 'grey' : 'blue-grey';
}
function formatDate(iso: string): string { return new Date(iso).toLocaleDateString(); }

function openNewForm(): void {
    form.value = blankForm(); isNew.value = true; formOpen.value = true;
}

async function openEditForm(topic: Topic): Promise<void> {
    form.value = {
        id: topic.id, status: topic.status, sourceLang: topic.sourceLang,
        iconPreview: topic.dataExtra?.icon ?? '', parentId: topic.parentId,
        translations: { [topic.sourceLang]: { title: topic.topic, description: topic.description ?? '' } },
        revisions: [],
    };
    isNew.value = false; formOpen.value = true; formLoading.value = true;
    const full = await store.getOne(topic.id);
    formLoading.value = false;
    if (!full) return;
    form.value.status = full.status ?? topic.status;
    form.value.sourceLang = full.sourceLang ?? topic.sourceLang;
    form.value.revisions = full.revisions ?? [];
    form.value.iconPreview = full.dataExtra?.icon ?? topic.dataExtra?.icon ?? '';
    form.value.parentId = full.parentId !== undefined ? full.parentId : topic.parentId;
    const tabs: Record<string, { title?: string; description: string }> = {};
    for (const [lang, entry] of Object.entries(full.translations ?? {})) {
        tabs[lang] = { title: entry.title, description: entry.description };
    }
    if (!tabs[form.value.sourceLang]) {
        tabs[form.value.sourceLang] = { title: topic.topic, description: topic.description ?? '' };
    }
    form.value.translations = tabs;
    logger.info('[TopicsPage] form loaded', { id: topic.id, langs: Object.keys(tabs), parentId: form.value.parentId });
}

function closeForm(): void {
    formOpen.value = false; formLoading.value = false;
    form.value = blankForm(); iconSizeError.value = null; iconFileRef.value = null;
}
function onTranslatableToggle(value: boolean): void {
    if (form.value.status === 'PUBLISHED') return;
    form.value.status = value ? 'APPROVED' : 'DRAFT';
}

function onIconSelected(file: File | File[] | null): void {
    iconSizeError.value = null;
    const f = Array.isArray(file) ? file[0] : file;
    if (!f) return;
    if (f.size > ICON_MAX_BYTES) {
        iconSizeError.value = t('warning.icon_too_large', { fileSize: Math.round(f.size / 1024), maxSize: iconMaxKb });
        iconFileRef.value = null;
        return;
    }
    const reader = new FileReader();
    reader.onload = () => { form.value.iconPreview = reader.result as string; };
    reader.onerror = () => { iconSizeError.value = t('warning.icon_read_error'); iconFileRef.value = null; };
    reader.readAsDataURL(f);
}

function onEditRowClick(topic: Topic): void {
    if (topic.status === 'PUBLISHED') { $q.notify({ color: 'red', message: t('warning.published_edit') }); return; }
    void openEditForm(topic);
}
function onDeleteRowClick(topic: Topic): void {
    $q.notify({
        type: 'warning', timeout: 0, message: t('warning.delete_topic'),
        actions: [
            {
                label: t('button.delete'), color: 'red',
                handler: () => {
                    void store.remove(topic.id).then(ok => {
                        if (!ok && store.error) { $q.notify({ type: 'negative', message: store.error }); store.clearError(); }
                    });
                },
            },
            { label: t('button.back'), color: 'accent', handler: () => { } },
        ],
    });
}
function onPublishedToggle(newValue: boolean, topic: Topic): void {
    if (newValue) void store.publish(topic.id);
    else void store.unpublish(topic.id);
}

async function onSave(): Promise<void> {
    const latestTranslations = mlTabsRef.value?.getAllTranslations() ?? form.value.translations;
    if (mlTabsRef.value?.hasAnyError()) { $q.notify({ color: 'negative', message: t('warning.req_fields') }); return; }
    const srcLang = form.value.sourceLang;
    const srcTitle = latestTranslations[srcLang]?.title?.trim() ?? '';
    if (!srcTitle) { $q.notify({ color: 'negative', message: t('warning.req_fields') }); return; }

    const translationEntries = Object.entries(latestTranslations)
        .filter(([lang, entry]) => {
            if (lang === srcLang) return true;
            return (entry.title?.trim() ?? '') !== '' || (entry.description?.trim() ?? '') !== '';
        })
        .map(([lang, entry]) => [lang, { title: entry.title?.trim() ?? '', description: entry.description ?? '' }]);

    const full: TopicFull = {
        status: form.value.status, sourceLang: srcLang, parentId: form.value.parentId,
        ...(form.value.iconPreview ? { dataExtra: { icon: form.value.iconPreview } } : {}),
        translations: Object.fromEntries(translationEntries),
    };

    if (isNew.value) {
        const created = await store.create({
            topic: srcTitle, description: latestTranslations[srcLang]?.description ?? '',
            status: form.value.status, sourceLang: srcLang, parentId: form.value.parentId,
            ...(form.value.iconPreview ? { dataExtra: { icon: form.value.iconPreview } } : {}),
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

function exportTopic(topic: Topic): void {
    const el = document.createElement('a');
    el.setAttribute('href', `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(topic, null, 2))}`);
    el.setAttribute('download', `${topic.topic || 'topic-' + topic.id}.json`);
    el.style.display = 'none'; document.body.appendChild(el); el.click(); document.body.removeChild(el);
}

/**
 * Shape expected when importing a topic from a JSON file.
 * Intentionally a concrete type (not Partial<TopicFull>) to avoid
 * the @typescript-eslint/no-redundant-type-constituents lint error
 * that fires when a Partial<T> union member collapses to `any`.
 */
interface ImportTopicPayload {
    sourceLang?: string;
    dataExtra?: { icon?: string };
    translations?: Record<string, TopicTranslation>;
}

const importInputRef = ref<HTMLInputElement | null>(null);
const importDialogOpen = ref(false);
const importPayload = ref<ImportTopicPayload | null>(null);

function onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const fr = new FileReader();
    fr.onload = (e) => {
        try { importPayload.value = JSON.parse(e.target?.result as string) as ImportTopicPayload; importDialogOpen.value = true; }
        catch { $q.notify({ type: 'negative', message: t('error.invalid_json') }); }
    };
    fr.readAsText(input.files[0]!);
    input.value = '';
}

async function confirmImport(): Promise<void> {
    if (!importPayload.value) return;
    importDialogOpen.value = false;
    const payload = importPayload.value;
    const srcLang = payload.sourceLang ?? app.defaultLang ?? 'it';
    const srcTr = payload.translations?.[srcLang];
    const created = await store.create({
        topic: srcTr?.title ?? 'Imported topic', description: srcTr?.description ?? '',
        status: 'DRAFT', sourceLang: srcLang, parentId: null,
        ...(payload.dataExtra?.icon ? { dataExtra: { icon: payload.dataExtra.icon } } : {}),
        ...(payload.translations !== undefined && {
            translations: Object.fromEntries(
                Object.entries(payload.translations).map(([l, tr]) => [l, { title: tr.title, description: tr.description }]),
            ),
        }),
    });
    if (created) $q.notify({ type: 'positive', message: t('notification.import_success') });
    importPayload.value = null;
}
</script>

<style scoped>
.icon-placeholder {
    width: 40px;
    height: 40px;
    background: #e0e0e0;
    border-radius: 4px;
}

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

.edit_button {
    width: 160px;
    background: #ffffff;
    border: 1px solid #ff7c44;
    border-radius: 5px;
    font-weight: 700;
}

.delete_button {
    width: 160px;
    background: #ffffff;
    border: 1px solid #9e1f63;
    border-radius: 5px;
    font-weight: 700;
}
</style>