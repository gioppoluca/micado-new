<template>
    <!--
    ProcessGraphPage — /guided_process_editor/:id/graph
    ════════════════════════════════════════════════════════════════════════════

    SKELETON — Graph editor placeholder.

    This page:
      • Receives the process ID from the route param
      • Loads process metadata (title) and the existing graph via the store
      • Shows Cancel | Add Step | Save Graph buttons (same as legacy StepManager)
      • Displays a placeholder canvas area (left) and a placeholder form panel (right)
      • Can already save an empty graph → useful for testing process workflow
        before VueFlow is wired up

    The full VueFlow graph editor (custom step nodes, edge handles, step form
    panel, step-link form panel) will be implemented in the next iteration.

    Route: /guided_process_editor/:id/graph
    Name:  process-graph
    -->
    <q-page padding>

        <!-- ── Header bar ─────────────────────────────────────────────────── -->
        <div class="banner text-center q-mb-md">
            {{ t('input_labels.manage_steps') }} –
            <em>{{ processTitle || `#${processId}` }}</em>
        </div>

        <!-- ── Error banner ───────────────────────────────────────────────── -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ── Action bar ──────────────────────────────────────────────────── -->
        <div class="row items-center q-gutter-sm q-mb-md">
            <!-- Back to process list -->
            <q-btn class="cancel_button" no-caps unelevated :label="t('button.cancel')" @click="goBack"
                data-cy="back_to_process" />

            <q-space />

            <!-- Instructions (matches Image 1) -->
            <div class="col text-body2 text-grey-7 q-px-md">
                <div>• {{ t('help.add_step_explain') }}</div>
                <div>• {{ t('help.click_step_graph') }}</div>
                <div>• {{ t('help.add_edge_explain') }}</div>
            </div>

            <q-space />

            <!-- Add Step (disabled in skeleton — will be enabled with VueFlow) -->
            <q-btn color="secondary" no-caps unelevated :label="t('button.add_step')" :disable="true" data-cy="addstep">
                <q-tooltip>{{ t('processes.graph_editor_coming_soon') }}</q-tooltip>
            </q-btn>

            <!-- Save Graph -->
            <q-btn class="save_button" color="accent" no-caps unelevated :label="t('button.save_graph')"
                :loading="store.graphLoading" @click="onSaveGraph" data-cy="savegraph" />
        </div>

        <!-- ── Main split: canvas left + form right ──────────────────────── -->
        <div class="row q-col-gutter-md">

            <!-- Canvas area (40%) -->
            <div class="col-12 col-md-5">
                <q-card style="min-height: 600px; position: relative;">
                    <q-card-section class="fit flex flex-center">
                        <q-inner-loading :showing="store.graphLoading" />

                        <!-- Skeleton content — replaced by VueFlow in next iteration -->
                        <div v-if="!store.graphLoading" class="text-center text-grey-5">
                            <q-icon name="account_tree" size="80px" class="q-mb-md" />
                            <div class="text-subtitle1 q-mb-xs">
                                {{ t('processes.graph_canvas_placeholder') }}
                            </div>
                            <div class="text-caption">
                                {{ t('processes.graph_editor_coming_soon') }}
                            </div>
                            <!-- Step count badge -->
                            <q-badge v-if="graphNodeCount > 0" color="primary" class="q-mt-md">
                                {{ graphNodeCount }} {{ t('processes.steps_loaded') }}
                            </q-badge>
                        </div>
                    </q-card-section>
                </q-card>
            </div>

            <!-- Form panel (60%) — placeholder -->
            <div class="col-12 col-md-7">
                <q-card style="min-height: 600px;">
                    <q-card-section>
                        <div class="text-subtitle2 text-grey-6 q-mb-md">
                            {{ t('processes.select_step_to_edit') }}
                        </div>
                        <!-- Step form will be rendered here when a node is selected -->
                        <div class="flex flex-center" style="min-height: 500px;">
                            <div class="text-center text-grey-4">
                                <q-icon name="touch_app" size="60px" class="q-mb-sm" />
                                <div class="text-body2">
                                    {{ t('help.click_step_graph') }}
                                </div>
                            </div>
                        </div>
                    </q-card-section>
                </q-card>
            </div>
        </div>
    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useProcessStore } from 'src/stores/process-store';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const store = useProcessStore();

// ─── Route param ─────────────────────────────────────────────────────────────

const processId = computed(() => Number(route.params['id']));

// ─── State ────────────────────────────────────────────────────────────────────

/** Process title — shown in the header. Loaded from the store. */
const processTitle = ref('');

/** Number of nodes in the currently loaded graph. */
const graphNodeCount = computed(() => store.graph?.nodes.length ?? 0);

// ─── Navigation ───────────────────────────────────────────────────────────────

function goBack(): void {
    void router.push({ name: 'processes' });
}

// ─── Graph save ───────────────────────────────────────────────────────────────

/**
 * Save the current graph state.
 * In the skeleton this saves whatever is already in store.graph
 * (either the loaded graph or an empty one).
 * Once VueFlow is wired up, this will serialise the VueFlow instance state.
 */
async function onSaveGraph(): Promise<void> {
    const graph = store.graph ?? { nodes: [], edges: [] };
    const ok = await store.saveGraph(processId.value, graph);
    if (ok) {
        $q.notify({ type: 'positive', message: t('processes.graph_saved') });
        logger.info('[ProcessGraphPage] graph saved', {
            processId: processId.value,
            nodes: graph.nodes.length,
            edges: graph.edges.length,
        });
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    // Load process metadata for the header title
    const full = await store.getOne(processId.value);
    if (full) {
        const srcLang = full.sourceLang ?? 'it';
        processTitle.value = full.translations?.[srcLang]?.title ?? '';
    }

    // Load existing graph (may be empty for a new process)
    await store.fetchGraph(processId.value);

    logger.info('[ProcessGraphPage] mounted', {
        processId: processId.value,
        title: processTitle.value,
        nodes: store.graph?.nodes.length ?? 0,
    });
});
</script>

<style scoped lang="scss">
.banner {
    font-style: normal;
    font-weight: bold;
    font-size: 28px;
    color: #0f3a5d;
    padding: 12px 0;
    border-bottom: 2px solid #0f3a5d;
}

.cancel_button {
    background: white;
    color: black;
    border: 1px solid #c71f40;
    min-width: 100px;
    border-radius: 5px;
}

.save_button {
    min-width: 130px;
    border-radius: 5px;
}
</style>