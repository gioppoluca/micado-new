<template>
    <!--
    CsvImportDialog.vue
    ════════════════════════════════════════════════════════════════════════
    Reusable dialog for CSV bulk import with per-row error reporting.

    ── Usage ───────────────────────────────────────────────────────────────
    <CsvImportDialog
        v-model="dialogOpen"
        :rows="parsedRows"
        :import-fn="store.bulkImport"
        @done="onImportDone"
    />

    ── Flow ─────────────────────────────────────────────────────────────────
    1. Parent parses the CSV file and passes CsvParseResult[] as :rows.
    2. This dialog shows a preview of the rows (title + first 60 chars of description).
    3. User clicks Import → bulkImport() is called, progress spinner shown.
    4. On completion, shows a report:
         ✓ N righe importate correttamente
         ✗ Righe con errore: (list of failed rows)
    5. User dismisses → @done emitted (parent can close dialog and refresh list).

    ── Props ────────────────────────────────────────────────────────────────
    modelValue    — controls dialog visibility (v-model)
    rows          — pre-parsed CsvParseResult[] from parseCsvRows()
    importFn      — async function that accepts CsvParseResult[] and returns BulkImportReport
    sourceLang    — shown in preview for context (default 'it')

    ── Emits ────────────────────────────────────────────────────────────────
    update:modelValue — standard v-model close
    done              — emitted after report is dismissed; parent should refresh list
    -->
    <q-dialog :model-value="modelValue" persistent @update:model-value="$emit('update:modelValue', $event)">
        <q-card style="min-width: 560px; max-width: 90vw">

            <!-- ── Phase: preview ──────────────────────────────────────────── -->
            <template v-if="phase === 'preview'">
                <q-card-section class="row items-center">
                    <div class="text-h6">{{ t('glossary.csv_import_title') }}</div>
                    <q-space />
                    <q-btn flat round icon="close" @click="cancel" />
                </q-card-section>

                <q-card-section>
                    <p class="text-body2 q-mb-sm">
                        {{ t('glossary.csv_import_preview', { count: validRows.length }) }}
                    </p>

                    <!-- Parse errors detected before import -->
                    <q-banner v-if="parseErrors.length" class="bg-warning text-white q-mb-sm" rounded dense>
                        <template #avatar><q-icon name="warning" /></template>
                        {{ t('glossary.csv_parse_errors', { count: parseErrors.length }) }}
                    </q-banner>

                    <q-list bordered separator dense class="rounded-borders"
                        style="max-height: 280px; overflow-y: auto">
                        <q-item v-for="r in rows" :key="r.row" dense>
                            <q-item-section avatar>
                                <q-icon :name="r.ok ? 'check_circle' : 'error'" :color="r.ok ? 'positive' : 'negative'"
                                    size="xs" />
                            </q-item-section>
                            <q-item-section>
                                <q-item-label v-if="r.ok" class="text-caption">
                                    <strong>{{ r.payload.title }}</strong>
                                    <span v-if="r.payload.description" class="text-grey-6">
                                        — {{ truncate(r.payload.description, 60) }}
                                    </span>
                                </q-item-label>
                                <q-item-label v-else class="text-caption text-negative">
                                    {{ t('glossary.csv_row_error', { row: r.row, error: r.error }) }}
                                </q-item-label>
                            </q-item-section>
                        </q-item>
                    </q-list>
                </q-card-section>

                <q-card-actions align="right" class="q-gutter-sm">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="cancel" />
                    <q-btn color="accent" no-caps unelevated rounded
                        :label="t('glossary.csv_import_start', { count: validRows.length })"
                        :disable="validRows.length === 0" @click="startImport" />
                </q-card-actions>
            </template>

            <!-- ── Phase: importing ────────────────────────────────────────── -->
            <template v-else-if="phase === 'importing'">
                <q-card-section class="column items-center q-py-xl q-gutter-md">
                    <q-spinner size="3rem" color="accent" />
                    <div class="text-body2">
                        {{ t('glossary.csv_importing', { current: importedSoFar, total: validRows.length }) }}
                    </div>
                    <q-linear-progress :value="validRows.length > 0 ? importedSoFar / validRows.length : 0"
                        color="accent" rounded style="width: 300px" />
                </q-card-section>
            </template>

            <!-- ── Phase: report ───────────────────────────────────────────── -->
            <template v-else-if="phase === 'report' && report">
                <q-card-section class="row items-center">
                    <div class="text-h6">{{ t('glossary.csv_report_title') }}</div>
                </q-card-section>

                <q-card-section>
                    <!-- Success summary -->
                    <div class="row items-center q-mb-sm q-gutter-xs">
                        <q-icon name="check_circle" color="positive" />
                        <span class="text-body2">
                            {{ t('glossary.csv_report_success', { count: report.successCount }) }}
                        </span>
                    </div>

                    <!-- Parse failures (before import) -->
                    <template v-if="parseErrors.length">
                        <div class="row items-center q-mb-xs q-gutter-xs">
                            <q-icon name="warning" color="warning" />
                            <span class="text-body2 text-warning">
                                {{ t('glossary.csv_report_parse_errors', { count: parseErrors.length }) }}
                            </span>
                        </div>
                    </template>

                    <!-- API failures -->
                    <template v-if="report.failures.length">
                        <div class="row items-center q-mb-xs q-gutter-xs">
                            <q-icon name="error" color="negative" />
                            <span class="text-body2 text-negative">
                                {{ t('glossary.csv_report_failures', { count: report.failures.length }) }}
                            </span>
                        </div>
                        <q-list bordered dense separator class="rounded-borders q-mt-xs"
                            style="max-height: 200px; overflow-y: auto">
                            <q-item v-for="f in report.failures" :key="f.row" dense>
                                <q-item-section>
                                    <q-item-label class="text-caption text-negative">
                                        {{ t('glossary.csv_report_row', { row: f.row, title: f.title }) }}
                                        — {{ f.error }}
                                    </q-item-label>
                                </q-item-section>
                            </q-item>
                        </q-list>
                    </template>
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn color="accent" no-caps unelevated rounded :label="t('button.close')" @click="done" />
                </q-card-actions>
            </template>

        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CsvParseResult } from 'src/api/glossary.api';
import type { BulkImportReport } from 'src/stores/glossary-store';

const { t } = useI18n();

// ─── Props & Emits ────────────────────────────────────────────────────────────

const props = withDefaults(defineProps<{
    modelValue: boolean;
    rows: CsvParseResult[];
    importFn: (rows: CsvParseResult[]) => Promise<BulkImportReport>;
}>(), {});

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'done'): void;
}>();

// ─── State ────────────────────────────────────────────────────────────────────

type Phase = 'preview' | 'importing' | 'report';
const phase = ref<Phase>('preview');
const report = ref<BulkImportReport | null>(null);
const importedSoFar = ref(0);

// ─── Computed ─────────────────────────────────────────────────────────────────

const validRows = computed(() => props.rows.filter(r => r.ok));
const parseErrors = computed(() => props.rows.filter(r => !r.ok));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
    // Strip Markdown markers for preview display
    const plain = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '');
    return plain.length <= maxLen ? plain : plain.slice(0, maxLen) + '…';
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function startImport(): Promise<void> {
    phase.value = 'importing';
    importedSoFar.value = 0;

    // Run bulkImport — the store handles row-by-row errors internally.
    // We track progress by wrapping each row in our own counter.
    // Since bulkImport() is atomic from our perspective, we show an
    // indeterminate progress until it resolves, then show the report.
    const result = await props.importFn(props.rows);
    report.value = result;
    phase.value = 'report';
}

function cancel(): void {
    phase.value = 'preview';
    report.value = null;
    importedSoFar.value = 0;
    emit('update:modelValue', false);
}

function done(): void {
    phase.value = 'preview';
    report.value = null;
    importedSoFar.value = 0;
    emit('update:modelValue', false);
    emit('done');
}
</script>