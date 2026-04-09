<template>
    <!--
    ProcessGraphPage — /guided_process_editor/:id/graph
    ════════════════════════════════════════════════════════════════════════════

    Two-column layout (left canvas 40% + right form panel 60%).

    ── Type strategy ────────────────────────────────────────────────────────
      The v-model:nodes and v-model:edges bindings require VueFlow's own
      Node<Data> and Edge<Data> types — these live in @vue-flow/core and
      are named  Node / Edge  (generic wrappers).
      Our domain shapes (GraphNodeData, GraphEdgeData, RequiredDocument) are
      the Data payloads inside those generics.
      Our ProcessNode/ProcessEdge are used only for the API serialisation
      (PUT /processes/:id/graph payload).

    ── VueFlow — no wrapper, used directly ──────────────────────────────────
      • Custom node type 'step' via <template #node-step> slot
      • <Handle> top (target) + bottom (source) = drag-to-connect built-in
      • @connect      → build new edge, addEdges(), open edge form
      • @nodeClick    → open step form
      • @edgeClick    → open edge form
      • @nodeDragStop → sync position back to nodes array
      • @paneClick    → clear selection
    -->
    <q-page padding>

        <!-- ── Banner ─────────────────────────────────────────────────────── -->
        <div class="banner text-center q-mb-sm">
            {{ t('input_labels.manage_steps') }} –
            <em>{{ processTitle || `#${processId}` }}</em>
        </div>

        <!-- ── Error banner ───────────────────────────────────────────────── -->
        <q-banner v-if="store.error" class="bg-negative text-white q-mb-sm" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ store.error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="store.clearError()" />
            </template>
        </q-banner>

        <!-- ── Toolbar ─────────────────────────────────────────────────────── -->
        <div class="row items-center q-col-gutter-sm q-mb-md">
            <div class="col-auto">
                <q-btn class="cancel_button" no-caps unelevated :label="t('button.cancel')" @click="goBack"
                    data-cy="back_to_process" />
            </div>
            <div class="col-auto">
                <q-btn color="secondary" no-caps unelevated :label="t('button.add_step')" @click="addStep"
                    data-cy="addstep" />
            </div>
            <div class="col text-caption text-grey-7 q-px-sm">
                <div>• {{ t('help.add_step_explain') }}</div>
                <div>• {{ t('help.click_step_graph') }}</div>
                <div>• {{ t('help.add_edge_explain') }}</div>
            </div>
            <div class="col-auto">
                <q-btn class="save_button" color="accent" no-caps unelevated :label="t('button.save_graph')"
                    :loading="store.graphLoading" @click="onSaveGraph" data-cy="savegraph" />
            </div>
        </div>

        <!-- ── Main split ──────────────────────────────────────────────────── -->
        <div class="row" style="height: 700px;">

            <!-- LEFT — VueFlow canvas (40%) -->
            <div class="col-12 col-md-5" style="height: 100%; padding-right: 8px;">
                <q-card style="height: 100%; overflow: hidden;">
                    <q-inner-loading :showing="store.graphLoading" />

                    <!--
                      v-model:nodes / v-model:edges: VueFlow expects Node<Data>[] / Edge<Data>[].
                      We type our refs as Node<GraphNodeData>[] etc — fully compatible.
                    -->
                    <VueFlow v-if="!store.graphLoading" v-model:nodes="nodes" v-model:edges="edges" fit-view-on-init
                        :connect-on-click="false" :nodes-draggable="true" :nodes-connectable="true" :snap-to-grid="true"
                        :snap-grid="[20, 20]" style="width:100%;height:100%;" @connect="onConnect"
                        @nodeClick="onNodeClick" @edgeClick="onEdgeClick" @nodeDragStop="onNodeDragStop"
                        @paneClick="clearSelection">
                        <!--
                          Custom step node — slot receives NodeProps<GraphNodeData>.
                          No wrapper class needed: VueFlow renders the slot directly.
                        -->
                        <template #node-step="nodeProps">
                            <div class="step-node" :class="{ 'step-node--selected': nodeProps.selected }">
                                <!-- Target handle: top — this node can receive edges -->
                                <Handle type="target" :position="Position.Top" class="step-handle" />

                                <div class="step-node__icon">
                                    <img v-if="nodeProps.data.iconUrl" :src="nodeProps.data.iconUrl"
                                        :alt="nodeProps.data.title"
                                        style="width:28px;height:28px;object-fit:contain;" />
                                    <q-icon v-else name="flag" size="28px" color="primary" />
                                </div>
                                <div class="step-node__title">
                                    {{ nodeProps.data.title || t('processes.new_step') }}
                                </div>
                                <div v-if="nodeProps.data.location" class="step-node__location">
                                    <q-icon name="place" size="12px" />
                                    {{ nodeProps.data.location }}
                                </div>

                                <!-- Source handle: bottom — drag from here to create an edge -->
                                <Handle type="source" :position="Position.Bottom" class="step-handle" />
                            </div>
                        </template>

                        <!-- Inline dot-pattern background (avoids @vue-flow/background dep) -->
                        <template #background>
                            <svg
                                style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1;">
                                <defs>
                                    <pattern id="vf-dots" width="20" height="20" patternUnits="userSpaceOnUse">
                                        <circle fill="#ccc" cx="1" cy="1" r="1" />
                                    </pattern>
                                </defs>
                                <rect width="100%" height="100%" fill="url(#vf-dots)" />
                            </svg>
                        </template>
                    </VueFlow>
                </q-card>
            </div>

            <!-- RIGHT — Form panel (60%) -->
            <div class="col-12 col-md-7" style="height: 100%; padding-left: 8px;">
                <q-card style="height: 100%; overflow-y: auto;">

                    <!-- ── STEP FORM ──────────────────────────────────────── -->
                    <q-card-section v-if="editing === 'step' && activeNodeId">
                        <div class="text-subtitle1 text-weight-medium q-mb-md">
                            {{ isNewStep ? t('processes.add_step_title') : t('processes.edit_step_title') }}
                        </div>

                        <!-- Title + description per language -->
                        <HelpLabel :field-label="t('input_labels.step_name')" :help-label="t('help.step_name')"
                            class="q-mb-xs" />
                        <MultiLangEditorTabs v-model="stepForm.translations" :languages="sortedLanguages"
                            :show-title="true" :title-max-length="255" :readonly="false"
                            data-cy="step_multilang_tabs" />

                        <!-- Link + Location -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.link')" :help-label="t('help.link')"
                                    class="q-mb-xs" />
                                <q-input v-model="stepForm.url" outlined dense :label="t('input_labels.link')"
                                    data-cy="link_input" />
                            </div>
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.step_location')"
                                    :help-label="t('help.step_location')" class="q-mb-xs" />
                                <q-input v-model="stepForm.location" outlined dense
                                    :label="t('input_labels.step_location')" data-cy="location_input">
                                    <template #append>
                                        <a v-if="stepForm.location"
                                            :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stepForm.location)}`"
                                            target="_blank" rel="noopener noreferrer">
                                            <q-icon name="place" color="accent" />
                                        </a>
                                        <q-icon v-else name="place" color="grey-4" />
                                    </template>
                                </q-input>
                            </div>
                        </div>

                        <!-- Icon + Cost -->
                        <div class="row q-col-gutter-md q-mt-md">
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.icon')" :help-label="t('help.doc_type_icon')"
                                    class="q-mb-xs" />
                                <q-input v-model="stepForm.iconUrl" outlined dense :label="t('input_labels.icon')"
                                    placeholder="https://…" data-cy="icon_input" />
                            </div>
                            <div class="col-12 col-sm-6">
                                <HelpLabel :field-label="t('input_labels.step_cost')" :help-label="t('help.step_cost')"
                                    class="q-mb-xs" />
                                <div class="row items-center q-gutter-sm">
                                    <q-input v-model="stepForm.cost" outlined dense class="col"
                                        :label="t('input_labels.step_cost')" :disable="stepForm.isFree"
                                        data-cy="cost_input" />
                                    <q-checkbox v-model="stepForm.isFree" :label="t('input_labels.event_is_free')" />
                                </div>
                            </div>
                        </div>

                        <!-- Required documents -->
                        <div class="q-mt-md">
                            <div class="row items-center q-mb-xs">
                                <HelpLabel :field-label="t('input_labels.required_documents')"
                                    :help-label="t('help.required_documents')" class="col" />
                                <q-btn flat dense no-caps size="sm" color="accent" :label="t('button.add_document')"
                                    @click="showDocPicker = !showDocPicker" data-cy="add_step_document" />
                            </div>

                            <!-- Doc picker row -->
                            <div v-if="showDocPicker" class="row q-col-gutter-sm q-mb-sm items-center">
                                <div class="col-8">
                                    <q-select v-model="pendingDoc.documentTypeId" :options="docTypeOptions"
                                        option-value="id" option-label="document" emit-value map-options clearable
                                        outlined dense :label="t('input_labels.required_documents')"
                                        data-cy="step_document_list" />
                                </div>
                                <div class="col-2">
                                    <q-input v-model="pendingDoc.cost" outlined dense
                                        :label="t('input_labels.doc_cost')" data-cy="doc_cost" />
                                </div>
                                <div class="col-2">
                                    <q-btn color="accent" no-caps unelevated size="sm"
                                        :label="t('button.save_document')" :disable="pendingDoc.documentTypeId == null"
                                        @click="saveStepDocument" data-cy="save_step_document" />
                                </div>
                            </div>

                            <template v-if="stepForm.requiredDocuments.length">
                                <div class="row text-caption text-grey-7 q-mb-xs">
                                    <div class="col-8">{{ t('input_labels.doc') }}</div>
                                    <div class="col-2 text-center">{{ t('input_labels.cost') }}</div>
                                    <div class="col-2 text-center">{{ t('input_labels.delete') }}</div>
                                </div>
                                <div v-for="(reqDoc, idx) in stepForm.requiredDocuments" :key="idx"
                                    class="row items-center q-mb-xs">
                                    <div class="col-8 text-body2">{{ docTypeLabel(reqDoc.documentTypeId) }}</div>
                                    <div class="col-2 text-center text-caption">{{ reqDoc.cost }}</div>
                                    <div class="col-2 text-center">
                                        <q-btn flat round icon="delete" size="sm" color="negative"
                                            @click="removeStepDocument(idx)" />
                                    </div>
                                </div>
                            </template>
                        </div>

                        <!-- Step form actions -->
                        <div class="row q-gutter-sm q-mt-lg">
                            <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.back')"
                                @click="clearSelection" />
                            <q-btn flat no-caps color="negative" :label="t('button.delete_step')"
                                @click="deleteActiveNode" data-cy="deletestep" />
                            <q-space />
                            <q-btn class="save_button" color="accent" no-caps unelevated rounded
                                :label="t('button.save_step')" @click="saveStep" data-cy="savestep" />
                        </div>
                    </q-card-section>

                    <!-- ── EDGE FORM ──────────────────────────────────────── -->
                    <q-card-section v-else-if="editing === 'link' && activeEdgeId">
                        <div class="text-subtitle1 text-weight-medium q-mb-md">
                            {{ t('processes.edit_link_title') }}
                        </div>

                        <HelpLabel :field-label="t('input_labels.link_name')" :help-label="t('help.link_name')"
                            class="q-mb-xs" />
                        <MultiLangEditorTabs v-model="linkForm.translations" :languages="sortedLanguages"
                            :show-title="true" :title-max-length="100" :readonly="false"
                            data-cy="link_multilang_tabs" />

                        <div class="row q-gutter-sm q-mt-lg">
                            <q-btn class="cancel_button" no-caps unelevated rounded :label="t('button.back')"
                                @click="clearSelection" data-cy="back_to_graph" />
                            <q-btn flat no-caps color="negative" :label="t('button.delete_steplink')"
                                @click="deleteActiveEdge" data-cy="deletesteplink" />
                            <q-space />
                            <q-btn class="save_button" color="accent" no-caps unelevated rounded
                                :label="t('button.save_steplink')" @click="saveLink" data-cy="savesteplink" />
                        </div>
                    </q-card-section>

                    <!-- ── EMPTY HINT ─────────────────────────────────────── -->
                    <q-card-section v-else class="flex flex-center" style="height:100%;min-height:200px;">
                        <div class="text-center text-grey-5">
                            <q-icon name="touch_app" size="60px" class="q-mb-sm" />
                            <div class="text-body2">{{ t('help.click_step_graph') }}</div>
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

// ── VueFlow — direct usage, no wrapper ───────────────────────────────────────
// Node<Data> / Edge<Data>   — generic types for v-model:nodes / v-model:edges
// VFGraphNode / VFGraphEdge — VueFlow's internal resolved types from getNodes/getEdges,
//                             aliased to avoid clash with our domain ProcessNode/ProcessEdge
import {
    VueFlow,
    Handle,
    Position,
    useVueFlow,
    type Node,
    type Edge,
    type Connection,
    type NodeMouseEvent,
    type EdgeMouseEvent,
    type NodeDragEvent,
    type GraphNode as VFGraphNode,
    type GraphEdge as VFGraphEdge,
} from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

import { useProcessStore } from 'src/stores/process-store';
import { useLanguageStore } from 'src/stores/language-store';
import { useDocumentTypeStore } from 'src/stores/document-type-store';
import { useAppStore } from 'src/stores/app-store';
import type {
    GraphNodeData,
    GraphEdgeData,
    GraphNodeTranslation,
    GraphEdgeTranslation,
    ProcessNode,
    ProcessEdge,
    RequiredDocument,
} from 'src/api/process.api';
import HelpLabel from 'src/components/HelpLabel.vue';
import MultiLangEditorTabs from 'src/components/rich-text-editor/MultiLangEditorTabs.vue';
import { logger } from 'src/services/Logger';

// ── Typed aliases ─────────────────────────────────────────────────────────────
// These are what VueFlow's v-model:nodes / v-model:edges expect.
type FlowNode = Node<GraphNodeData>;
type FlowEdge = Edge<GraphEdgeData>;

// ─── Composables ──────────────────────────────────────────────────────────────

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const store = useProcessStore();
const langStore = useLanguageStore();
const docTypeStore = useDocumentTypeStore();
const appStore = useAppStore();

const { addEdges, removeNodes, removeEdges, getNodes, getEdges, fitView } = useVueFlow();

// ─── Route param ──────────────────────────────────────────────────────────────

const processId = computed(() => Number(route.params['id']));

// ─── Graph state — typed as VueFlow's Node/Edge for v-model compatibility ─────

const nodes = ref<FlowNode[]>([]);
const edges = ref<FlowEdge[]>([]);
const processTitle = ref('');

// ─── Form panel state — IDs only (not node references, to avoid stale closure) ─

type EditMode = 'step' | 'link' | null;
const editing = ref<EditMode>(null);
const isNewStep = ref(false);
const activeNodeId = ref<string | null>(null);   // ID of node being edited
const activeEdgeId = ref<string | null>(null);   // ID of edge being edited

// ─── Step form ────────────────────────────────────────────────────────────────

interface StepForm {
    translations: Record<string, { title?: string; description: string }>;
    url: string;
    location: string;
    iconUrl: string;
    cost: string;
    isFree: boolean;
    requiredDocuments: RequiredDocument[];
}

const stepForm = ref<StepForm>(blankStepForm());

function blankStepForm(): StepForm {
    const src = appStore.defaultLang || 'it';
    return {
        translations: { [src]: { title: '', description: '' } },
        url: '', location: '', iconUrl: '', cost: '', isFree: true, requiredDocuments: [],
    };
}

// ─── Edge form ────────────────────────────────────────────────────────────────

interface LinkForm {
    translations: Record<string, { title?: string; description: string }>;
}

const linkForm = ref<LinkForm>(blankLinkForm());

function blankLinkForm(): LinkForm {
    const src = appStore.defaultLang || 'it';
    return { translations: { [src]: { title: '', description: '' } } };
}

// ─── Document picker ──────────────────────────────────────────────────────────

const showDocPicker = ref(false);
const pendingDoc = ref<{ documentTypeId: number | null; cost: string }>({
    documentTypeId: null, cost: '',
});
const docTypeOptions = computed(() => docTypeStore.documentTypes);

// ─── Language helpers ─────────────────────────────────────────────────────────

const sortedLanguages = computed(() => {
    const src = appStore.defaultLang || 'it';
    const active = langStore.activeLanguages;
    return [
        ...active.filter(l => l.lang === src),
        ...active.filter(l => l.lang !== src).sort((a, b) => a.lang.localeCompare(b.lang)),
    ];
});

function ensureTranslationTabs(form: { translations: Record<string, { title?: string; description: string }> }): void {
    for (const l of langStore.activeLanguages) {
        if (!form.translations[l.lang]) {
            form.translations[l.lang] = { title: '', description: '' };
        }
    }
}

function docTypeLabel(id: number): string {
    return docTypeStore.documentTypes.find(d => d.id === id)?.document ?? String(id);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function goBack(): void {
    void router.push({ name: 'processes' });
}

// ─── Clear selection ──────────────────────────────────────────────────────────

function clearSelection(): void {
    editing.value = null;
    activeNodeId.value = null;
    activeEdgeId.value = null;
    isNewStep.value = false;
    showDocPicker.value = false;
}

// ─── Add step ─────────────────────────────────────────────────────────────────

function addStep(): void {
    const id = crypto.randomUUID();
    const srcLang = appStore.defaultLang || 'it';
    const existingCount = nodes.value.length;

    const newNode: FlowNode = {
        id,
        type: 'step',
        position: { x: 200, y: existingCount * 160 + 50 },
        data: {
            title: '',
            description: '',
            status: 'DRAFT',
            sourceLang: srcLang,
            location: '', cost: '', isFree: true, url: '', iconUrl: '',
            requiredDocuments: [],
            translations: { [srcLang]: { title: '', description: '', tStatus: 'DRAFT' } },
        },
    };

    nodes.value = [...nodes.value, newNode];
    openStepFormById(id, true);
}

// ─── Node click → open step form ─────────────────────────────────────────────

function onNodeClick({ node }: NodeMouseEvent): void {
    openStepFormById(node.id, false);
}

function openStepFormById(nodeId: string, isNew: boolean): void {
    activeNodeId.value = nodeId;
    activeEdgeId.value = null;
    isNewStep.value = isNew;
    editing.value = 'step';

    const node = nodes.value.find(n => n.id === nodeId);
    // node.data is optional in VueFlow's Node<> generic — guard before access
    if (!node?.data) return;
    const nodeData = node.data;

    const form = blankStepForm();
    // Object.entries returns [string, unknown][] — iterate via typed record
    const nodeTrs: Record<string, GraphNodeTranslation> = nodeData.translations ?? {};
    for (const lang of Object.keys(nodeTrs)) {
        const entry = nodeTrs[lang];
        if (entry) {
            form.translations[lang] = { title: entry.title ?? '', description: entry.description ?? '' };
        }
    }
    ensureTranslationTabs(form);
    form.url = nodeData.url ?? '';
    form.location = nodeData.location ?? '';
    form.iconUrl = nodeData.iconUrl ?? '';
    form.cost = nodeData.cost ?? '';
    form.isFree = nodeData.isFree ?? true;
    form.requiredDocuments = [...(nodeData.requiredDocuments ?? [])];
    stepForm.value = form;
    showDocPicker.value = false;
}

// ─── Save step form → update nodes ───────────────────────────────────────────

function saveStep(): void {
    if (!activeNodeId.value) return;
    const nodeId = activeNodeId.value;
    const srcLang = appStore.defaultLang || 'it';
    const srcTitle = (stepForm.value.translations[srcLang]?.title ?? '').trim();

    if (!srcTitle) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    const updatedTranslations: GraphNodeData['translations'] = {};
    for (const lang of Object.keys(stepForm.value.translations)) {
        const entry = stepForm.value.translations[lang];
        if (entry) {
            updatedTranslations[lang] = {
                title: entry.title ?? '',
                description: entry.description ?? '',
                tStatus: 'DRAFT',
            };
        }
    }

    const node = nodes.value.find(n => n.id === nodeId);
    // node.data is optional in VueFlow's Node<> — guard before spread
    if (!node?.data) return;
    const nodeData = node.data;

    const updatedData: GraphNodeData = {
        ...nodeData,
        title: srcTitle,
        description: stepForm.value.translations[srcLang]?.description ?? '',
        url: stepForm.value.url,
        location: stepForm.value.location,
        iconUrl: stepForm.value.iconUrl,
        cost: stepForm.value.isFree ? '' : stepForm.value.cost,
        isFree: stepForm.value.isFree,
        requiredDocuments: [...stepForm.value.requiredDocuments],
        translations: updatedTranslations,
    };

    // Correct spread pattern — never mutate in place
    nodes.value = nodes.value.map(n =>
        n.id === nodeId ? { ...n, data: updatedData } : n,
    );

    logger.info('[ProcessGraphPage] saveStep', { id: nodeId, title: srcTitle });
    clearSelection();
}

// ─── Delete active node ───────────────────────────────────────────────────────

function deleteActiveNode(): void {
    if (!activeNodeId.value) return;
    const id = activeNodeId.value;
    removeNodes([id]);
    nodes.value = nodes.value.filter(n => n.id !== id);
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id);
    clearSelection();
    logger.warn('[ProcessGraphPage] deleteNode', { id });
}

// ─── Node drag stop → sync position ──────────────────────────────────────────

function onNodeDragStop({ node }: NodeDragEvent): void {
    nodes.value = nodes.value.map(n =>
        n.id === node.id
            ? { ...n, position: { x: node.position.x, y: node.position.y } }
            : n,
    );
}

// ─── Connect (drag between handles) → add edge ───────────────────────────────

function onConnect(connection: Connection): void {
    const srcLang = appStore.defaultLang || 'it';
    const newEdge: FlowEdge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        type: 'step-link',
        label: '',
        data: {
            status: 'DRAFT',
            sourceLang: srcLang,
            translations: { [srcLang]: { title: '', tStatus: 'DRAFT' } },
        },
    };
    addEdges([newEdge]);
    edges.value = [...edges.value, newEdge];
    openEdgeFormById(newEdge.id);
    logger.info('[ProcessGraphPage] onConnect', { source: connection.source, target: connection.target });
}

// ─── Edge click → open edge form ─────────────────────────────────────────────

function onEdgeClick({ edge }: EdgeMouseEvent): void {
    openEdgeFormById(edge.id);
}

function openEdgeFormById(edgeId: string): void {
    activeEdgeId.value = edgeId;
    activeNodeId.value = null;
    editing.value = 'link';

    const edge = edges.value.find(e => e.id === edgeId);
    if (!edge) return;

    const form = blankLinkForm();
    // edge.data is optional in VueFlow's Edge<> — guard before access
    const edgeTrs: Record<string, GraphEdgeTranslation> = edge.data?.translations ?? {};
    for (const lang of Object.keys(edgeTrs)) {
        const entry = edgeTrs[lang];
        if (entry) {
            form.translations[lang] = { title: entry.title ?? '', description: '' };
        }
    }
    ensureTranslationTabs(form);
    linkForm.value = form;
}

// ─── Save edge form ───────────────────────────────────────────────────────────

function saveLink(): void {
    if (!activeEdgeId.value) return;
    const edgeId = activeEdgeId.value;
    const srcLang = appStore.defaultLang || 'it';
    const srcLabel = (linkForm.value.translations[srcLang]?.title ?? '').trim();

    const updatedTranslations: Record<string, { title: string; tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
    for (const lang of Object.keys(linkForm.value.translations)) {
        const entry = linkForm.value.translations[lang];
        if (entry) {
            updatedTranslations[lang] = { title: entry.title ?? '', tStatus: 'DRAFT' };
        }
    }

    edges.value = edges.value.map(e =>
        e.id === edgeId
            ? {
                ...e,
                label: srcLabel,
                data: {
                    ...e.data,
                    status: 'DRAFT' as const,
                    sourceLang: srcLang,
                    translations: updatedTranslations,
                },
            }
            : e,
    );

    logger.info('[ProcessGraphPage] saveLink', { id: edgeId, label: srcLabel });
    clearSelection();
}

// ─── Delete active edge ───────────────────────────────────────────────────────

function deleteActiveEdge(): void {
    if (!activeEdgeId.value) return;
    const id = activeEdgeId.value;
    removeEdges([id]);
    edges.value = edges.value.filter(e => e.id !== id);
    clearSelection();
    logger.warn('[ProcessGraphPage] deleteEdge', { id });
}

// ─── Required documents ───────────────────────────────────────────────────────

function saveStepDocument(): void {
    if (pendingDoc.value.documentTypeId == null) return;
    stepForm.value.requiredDocuments.push({
        documentTypeId: pendingDoc.value.documentTypeId,
        cost: pendingDoc.value.cost,
        isOut: false,
    });
    pendingDoc.value = { documentTypeId: null, cost: '' };
    showDocPicker.value = false;
}

function removeStepDocument(idx: number): void {
    stepForm.value.requiredDocuments.splice(idx, 1);
}

// ─── Save Graph ───────────────────────────────────────────────────────────────

async function onSaveGraph(): Promise<void> {
    // VueFlow's getNodes is authoritative for current positions after drags
    const vfNodes = getNodes.value;
    const vfEdges = getEdges.value;

    // Build ProcessNode[] for the API — merge VueFlow positions into domain nodes
    const finalNodes: ProcessNode[] = nodes.value.map((n: FlowNode) => {
        const vfNode = vfNodes.find((v: VFGraphNode) => v.id === n.id);
        return {
            id: n.id,
            // exactOptionalPropertyTypes: omit type key when undefined
            ...(n.type && { type: n.type }),
            position: vfNode
                ? { x: vfNode.position.x, y: vfNode.position.y }
                : { x: n.position.x, y: n.position.y },
            // n.data is optional in VueFlow's Node<> — provide fallback
            data: n.data ?? {
                title: '', description: '', status: 'DRAFT' as const,
                sourceLang: 'it', requiredDocuments: [], translations: {},
            },
        };
    });

    // Build ProcessEdge[] for the API
    const finalEdges: ProcessEdge[] = edges.value.map((e: FlowEdge) => {
        const vfEdge = vfEdges.find((v: VFGraphEdge) => v.id === e.id);
        return {
            id: e.id,
            source: vfEdge?.source ?? e.source,
            target: vfEdge?.target ?? e.target,
            // exactOptionalPropertyTypes: omit type key when undefined
            ...(e.type && { type: e.type }),
            label: typeof e.label === 'string' ? e.label : '',
            // e.data is optional in VueFlow's Edge<> — provide fallback
            data: e.data ?? {
                status: 'DRAFT' as const,
                sourceLang: 'it',
                translations: {},
            },
        };
    });

    const ok = await store.saveGraph(processId.value, { nodes: finalNodes, edges: finalEdges });

    if (ok) {
        $q.notify({ type: 'positive', message: t('processes.graph_saved') });
        // Re-fetch to get stable numeric IDs for any newly created nodes/edges
        const fresh = await store.fetchGraph(processId.value);
        if (fresh) {
            nodes.value = fresh.nodes.map((n: ProcessNode) => ({
                id: n.id,
                type: n.type ?? 'step',
                position: n.position,
                data: n.data,
            }));
            edges.value = fresh.edges.map((e: ProcessEdge) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                type: e.type ?? 'step-link',
                label: e.label ?? '',
                data: e.data ?? { status: 'DRAFT' as const, sourceLang: 'it', translations: {} },
            }));
            void fitView();
        }
        logger.info('[ProcessGraphPage] graph saved & reloaded', {
            processId: processId.value,
            nodes: fresh?.nodes.length ?? 0,
        });
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    if (docTypeStore.documentTypes.length === 0) await docTypeStore.fetchAll();
    if (langStore.languages.length === 0) await langStore.fetchAll();

    // Load process title for banner
    const full = await store.getOne(processId.value);
    if (full) {
        const srcLang = full.sourceLang ?? 'it';
        processTitle.value = full.translations?.[srcLang]?.title ?? '';
    }

    // Load existing graph and map to FlowNode/FlowEdge
    const g = await store.fetchGraph(processId.value);
    if (g) {
        nodes.value = g.nodes.map((n: ProcessNode) => ({
            id: n.id,
            type: n.type ?? 'step',
            position: n.position,
            data: n.data,
        }));
        edges.value = g.edges.map((e: ProcessEdge) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type ?? 'step-link',
            label: e.label ?? '',
            data: e.data ?? { status: 'DRAFT' as const, sourceLang: 'it', translations: {} },
        }));
    }

    logger.info('[ProcessGraphPage] mounted', {
        processId: processId.value,
        title: processTitle.value,
        nodes: nodes.value.length,
    });
});
</script>

<style scoped lang="scss">
.banner {
    font-weight: bold;
    font-size: 26px;
    color: #0f3a5d;
    padding: 10px 0;
    border-bottom: 2px solid #0f3a5d;
}

.cancel_button {
    background: white;
    color: black;
    border: 1px solid #c71f40;
    min-width: 90px;
    border-radius: 5px;
}

.save_button {
    min-width: 120px;
    border-radius: 5px;
}

/* Custom step node — rendered inside VueFlow canvas */
.step-node {
    background: white;
    border: 2px solid #0f3a5d;
    border-radius: 8px;
    padding: 10px 14px;
    min-width: 140px;
    max-width: 200px;
    text-align: center;
    cursor: pointer;
    transition: box-shadow 0.15s, border-color 0.15s;
    user-select: none;

    &:hover {
        box-shadow: 0 2px 8px rgba(15, 58, 93, 0.25);
    }

    &--selected {
        border-color: #ff7c44;
        box-shadow: 0 0 0 2px rgba(255, 124, 68, 0.3);
    }

    &__icon {
        display: flex;
        justify-content: center;
        margin-bottom: 4px;
    }

    &__title {
        font-size: 13px;
        font-weight: 600;
        color: #0f3a5d;
        line-height: 1.3;
        word-break: break-word;
    }

    &__location {
        font-size: 11px;
        color: #888;
        margin-top: 3px;
    }
}

/* Handle dots — orange accent matching Micado palette */
:deep(.step-handle) {
    width: 10px !important;
    height: 10px !important;
    background: #ff7c44 !important;
    border: 2px solid white !important;
}
</style>