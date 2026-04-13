<template>
    <!--
    TranslationManagementPage  /data_settings/language
    ════════════════════════════════════════════════════

    Shows a live view of all DBOS translation workflows and the Weblate
    commit staging queue.  Polls GET /api/translation-monitor every 30 s.

    Layout:
      ┌─────────────────────────────────────────────────┐
      │  Header: title · counters · refresh toggle      │
      ├─────────────────────────────────────────────────┤
      │  Active Workflows                               │
      │  ┌──────────────────────────────────────────┐   │
      │  │ category · itemId · progress bar         │ ▸ │
      │  │   ┌──lang──┬──status chip──┬──mp3──┐     │   │
      │  │   │  it    │  DONE (green) │  🔊   │     │   │
      │  │   │  fr    │  WAITING (↻)  │  —    │     │   │
      │  │   └────────┴───────────────┴───────┘     │   │
      │  └──────────────────────────────────────────┘   │
      │  (one card per master workflow)                 │
      ├─────────────────────────────────────────────────┤
      │  Staged commit queue (table)                    │
      └─────────────────────────────────────────────────┘
    -->
    <q-page padding>

        <!-- ── Page title ──────────────────────────────────────────────── -->
        <div class="row items-center q-mb-lg">
            <div class="col">
                <h5 class="q-my-none">{{ t('data_settings.translations') }}</h5>
                <div class="text-caption text-grey-6 q-mt-xs">
                    {{ t('translation_monitor.subtitle') }}
                </div>
            </div>

            <!-- Refresh controls -->
            <div class="col-auto row items-center q-gutter-sm">
                <span class="text-caption text-grey-6">
                    {{ lastUpdatedLabel }}
                </span>
                <q-toggle v-model="autoRefresh" color="secondary" :label="t('translation_monitor.auto_refresh')" dense
                    class="text-caption" />
                <q-btn flat dense round icon="refresh" color="secondary" :loading="loading" @click="fetchSnapshot">
                    <q-tooltip>{{ t('translation_monitor.refresh') }}</q-tooltip>
                </q-btn>
            </div>
        </div>

        <!-- ── Error banner ────────────────────────────────────────────── -->
        <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="error = null" />
            </template>
        </q-banner>

        <!-- ══════════════════════════════════════════════════════════════
             SECTION 1 — ACTIVE WORKFLOWS
        ═══════════════════════════════════════════════════════════════ -->
        <div class="section-header row items-center q-mb-sm">
            <q-icon name="account_tree" size="1.1rem" color="secondary" class="q-mr-sm" />
            <span class="text-subtitle2">{{ t('translation_monitor.active_workflows') }}</span>
            <q-badge v-if="activeWorkflows.length" :label="activeWorkflows.length" color="secondary" class="q-ml-sm" />
        </div>

        <!-- Loading skeletons -->
        <template v-if="loading && !snapshot">
            <q-card v-for="n in 3" :key="n" flat bordered class="q-mb-sm">
                <q-card-section>
                    <q-skeleton type="text" width="40%" />
                    <q-skeleton type="text" width="20%" class="q-mt-sm" />
                </q-card-section>
            </q-card>
        </template>

        <!-- Empty state -->
        <q-card v-else-if="!loading && activeWorkflows.length === 0" flat bordered class="q-mb-md text-center q-py-lg">
            <q-icon name="check_circle_outline" size="2.5rem" color="positive" />
            <div class="text-body2 text-grey-6 q-mt-sm">
                {{ t('translation_monitor.no_workflows') }}
            </div>
        </q-card>

        <!-- Workflow cards -->
        <q-card v-for="wf in activeWorkflows" :key="wf.revisionId" flat bordered class="q-mb-sm workflow-card"
            :class="{ 'workflow-card--done': wf.done }">
            <!-- Card header — collapsible trigger -->
            <q-expansion-item expand-separator :default-opened="!wf.done" :header-class="wf.done ? 'text-grey-6' : ''">
                <template #header>
                    <q-item-section avatar>
                        <!-- Done vs in-progress indicator -->
                        <q-icon v-if="wf.done" name="task_alt" size="1.4rem" color="positive" />
                        <q-circular-progress v-else indeterminate size="1.4rem" color="secondary"
                            track-color="grey-3" />
                    </q-item-section>

                    <q-item-section>
                        <q-item-label class="text-weight-medium">
                            <span class="text-accent">{{ wf.category }}</span>
                            <span class="text-grey-5 q-mx-xs">/</span>
                            <span>{{ wf.itemId }}</span>
                        </q-item-label>
                        <q-item-label caption>
                            <!-- Source fields preview -->
                            <span v-if="wf.sourceFields.title" class="q-mr-sm">
                                "{{ truncate(wf.sourceFields.title, 50) }}"
                            </span>
                            <span class="text-grey-5">
                                {{ t('translation_monitor.started') }}
                                {{ relativeTime(wf.startedAt) }}
                            </span>
                        </q-item-label>
                    </q-item-section>

                    <!-- Overall progress -->
                    <q-item-section side>
                        <div class="row items-center q-gutter-sm">
                            <span class="text-caption text-grey-6">
                                {{ doneLangs(wf) }}/{{ wf.targetLangs.length }}
                            </span>
                            <q-linear-progress :value="progressValue(wf)" :color="progressColor(wf)"
                                track-color="grey-3" rounded style="width: 80px" size="6px" />
                        </div>
                    </q-item-section>
                </template>

                <!-- Expanded body: per-language status grid -->
                <q-card-section class="q-pt-none">
                    <q-separator class="q-mb-md" />

                    <!-- revision UUID in small print -->
                    <div class="text-caption text-grey-5 q-mb-sm font-mono">
                        {{ t('translation_monitor.revision_id') }}: {{ wf.revisionId }}
                    </div>

                    <!-- Language grid -->
                    <div class="lang-grid">
                        <div v-for="lang in wf.targetLangs" :key="lang" class="lang-row row items-center q-py-xs">
                            <!-- Language code -->
                            <div class="col-2">
                                <q-chip square dense color="grey-2" text-color="grey-8" class="font-mono text-caption">
                                    {{ lang }}
                                </q-chip>
                            </div>

                            <!-- Status chip -->
                            <div class="col">
                                <StatusChip :status="wf.languages[lang]?.status ?? null" />
                            </div>

                            <!-- MP3 link if available -->
                            <div class="col-auto">
                                <q-btn v-if="wf.languages[lang]?.mp3Url" flat dense round icon="volume_up"
                                    color="secondary" size="sm" :href="wf.languages[lang]!.mp3Url!" target="_blank">
                                    <q-tooltip>{{ t('translation_monitor.listen_mp3') }}</q-tooltip>
                                </q-btn>
                                <q-icon v-else name="volume_off" size="1rem" color="grey-4" />
                            </div>
                        </div>
                    </div>
                </q-card-section>
            </q-expansion-item>
        </q-card>

        <!-- ══════════════════════════════════════════════════════════════
             SECTION 2 — STAGED COMMIT QUEUE
        ═══════════════════════════════════════════════════════════════ -->
        <div class="section-header row items-center q-mb-sm q-mt-lg">
            <q-icon name="pending_actions" size="1.1rem" color="secondary" class="q-mr-sm" />
            <span class="text-subtitle2">{{ t('translation_monitor.staged_queue') }}</span>
            <q-badge v-if="stagedCommits.length" :label="stagedCommits.length"
                :color="stagedCommits.length > 0 ? 'warning' : 'grey-4'" class="q-ml-sm" />
            <q-space />
            <div class="text-caption text-grey-5">
                {{ t('translation_monitor.staged_desc') }}
            </div>
        </div>

        <q-table v-if="!loading || snapshot" :rows="stagedCommits" :columns="stagedColumns" row-key="id" flat bordered
            dense :rows-per-page-options="[10, 25, 0]" :no-data-label="t('translation_monitor.staged_empty')"
            class="staged-table">
            <!-- Status column -->
            <template #body-cell-status="props">
                <q-td :props="props">
                    <q-chip dense square :color="props.row.status === 'NEW' ? 'warning' : 'orange-3'" text-color="white"
                        class="text-caption">
                        {{ props.row.status }}
                    </q-chip>
                </q-td>
            </template>

            <!-- receivedAt column -->
            <template #body-cell-receivedAt="props">
                <q-td :props="props">
                    <span class="text-caption">{{ relativeTime(props.row.receivedAt) }}</span>
                    <q-tooltip>{{ props.row.receivedAt }}</q-tooltip>
                </q-td>
            </template>
        </q-table>

        <!-- Skeleton for staged table -->
        <q-skeleton v-else height="120px" />

        <!-- ── Footer note ─────────────────────────────────────────────── -->
        <div class="text-caption text-grey-5 q-mt-md q-pb-lg text-center">
            {{ t('translation_monitor.footer_note') }}
        </div>

    </q-page>
</template>

<script setup lang="ts">
/**
 * TranslationManagementPage — Settings → Translations
 *
 * Polls GET /api/translation-monitor (30 s interval when auto-refresh is on).
 * All state is local — no Pinia store needed for a polling-based monitor page.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import StatusChip from 'src/components/settings/StatusChip.vue';
import { translationMonitorApi } from 'src/api/translation-monitor.api';
import type {
    TranslationMonitorSnapshot,
    WorkflowSummary,
    StagedCommitSummary,
} from 'src/api/translation-monitor.api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();

// ── State ─────────────────────────────────────────────────────────────────────

const snapshot = ref<TranslationMonitorSnapshot>({} as TranslationMonitorSnapshot);
const loading = ref(false);
const error = ref<string | null>(null);
const lastUpdated = ref<Date | null>(null);
const autoRefresh = ref(true);

let refreshTimer: ReturnType<typeof setInterval> | null = null;
const REFRESH_INTERVAL_MS = 30_000;

// ── Derived ───────────────────────────────────────────────────────────────────

const activeWorkflows = computed<WorkflowSummary[]>(
    () => snapshot.value?.activeWorkflows ?? [],
);

const stagedCommits = computed<StagedCommitSummary[]>(
    () => snapshot.value?.stagedCommits ?? [],
);

const lastUpdatedLabel = computed(() => {
    if (!lastUpdated.value) return '';
    return t('translation_monitor.updated_at', {
        time: lastUpdated.value.toLocaleTimeString(),
    });
});

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSnapshot(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        snapshot.value = await translationMonitorApi.getSnapshot();
        lastUpdated.value = new Date();
        logger.info('[TranslationManagementPage] snapshot loaded', {
            workflows: snapshot.value.activeWorkflows.length,
            staged: snapshot.value.stagedCommits.length,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        error.value = msg;
        logger.error('[TranslationManagementPage] fetch failed', { error: msg });
    } finally {
        loading.value = false;
    }
}

function startAutoRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (autoRefresh.value) void fetchSnapshot();
    }, REFRESH_INTERVAL_MS);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
    void fetchSnapshot();
    startAutoRefresh();
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
});

// ── Staged commits table columns ──────────────────────────────────────────────

const stagedColumns = [
    { name: 'component', label: t('translation_monitor.col_component'), field: 'component', align: 'left' as const, sortable: true },
    { name: 'lang', label: t('translation_monitor.col_lang'), field: 'lang', align: 'left' as const, sortable: true },
    { name: 'changeId', label: t('translation_monitor.col_change_id'), field: 'changeId', align: 'left' as const },
    { name: 'status', label: t('translation_monitor.col_status'), field: 'status', align: 'left' as const },
    { name: 'receivedAt', label: t('translation_monitor.col_received'), field: 'receivedAt', align: 'left' as const, sortable: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function doneLangs(wf: WorkflowSummary): number {
    return wf.targetLangs.filter(lang => wf.languages[lang]?.status === 'DONE').length;
}

function progressValue(wf: WorkflowSummary): number {
    if (!wf.targetLangs.length) return 0;
    return doneLangs(wf) / wf.targetLangs.length;
}

function progressColor(wf: WorkflowSummary): string {
    const v = progressValue(wf);
    if (v === 1) return 'positive';
    const langs = Object.values(wf.languages);
    if (langs.some(l => l.status === 'ERROR' || l.status === 'TIMEOUT')) return 'negative';
    return 'secondary';
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function relativeTime(iso: string | undefined): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return t('translation_monitor.ago_seconds', { n: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t('translation_monitor.ago_minutes', { n: m });
    const hr = Math.floor(m / 60);
    return t('translation_monitor.ago_hours', { n: hr });
}
</script>

<style scoped>
/* ── Section headers ────────────────────────────────────────────────────── */
.section-header {
    border-left: 3px solid #0b91ce;
    padding-left: 10px;
}

/* ── Workflow cards ─────────────────────────────────────────────────────── */
.workflow-card {
    transition: box-shadow 0.15s;
}

.workflow-card:hover {
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

.workflow-card--done {
    opacity: 0.75;
}

/* ── Language grid ──────────────────────────────────────────────────────── */
.lang-grid {
    border-left: 2px solid #e0e8ee;
    padding-left: 12px;
}

.lang-row {
    border-bottom: 1px solid #f5f5f5;
}

.lang-row:last-child {
    border-bottom: none;
}

/* ── Mono font for IDs ──────────────────────────────────────────────────── */
.font-mono {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
}

/* ── Staged table ───────────────────────────────────────────────────────── */
.staged-table {
    font-size: 0.85rem;
}
</style>