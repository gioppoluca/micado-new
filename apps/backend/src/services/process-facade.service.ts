/**
 * src/services/process-facade.service.ts
 *
 * Facade for PROCESS content items (Step-by-Step Guides).
 *
 * ── Responsibility split ──────────────────────────────────────────────────────
 *
 *   This facade handles TWO concerns:
 *
 *   1. Process CRUD — metadata only (title, description, relations)
 *      GET /processes          → find()
 *      GET /processes/count    → count()
 *      POST /processes         → create()
 *      GET /processes/:id      → findById()
 *      PUT /processes/:id      → replaceById()
 *      PATCH /processes/:id    → updateById()
 *      DELETE /processes/:id   → deleteById()
 *      GET /processes/to-production?id= → publish()
 *      GET /processes-migrant  → getTranslatedForFrontend()
 *
 *   2. Graph management — atomic STEP + STEP_LINK CRUD
 *      GET /processes/:id/graph → getGraph()
 *      PUT /processes/:id/graph → saveGraph()
 *
 *      Steps and step-links are NOT exposed as independent REST resources.
 *      They are always read/written as a complete atomic graph unit.
 *
 * ── Atomic graph save ─────────────────────────────────────────────────────────
 *
 *   saveGraph() implements:
 *     1. Delete all STEP content items for processId
 *     2. Delete all STEP_LINK content items for processId
 *     3. Re-insert all nodes as STEP content items (preserving posX/posY)
 *     4. Re-insert all edges as STEP_LINK content items
 *     Returns 204 — frontend re-fetches getGraph() to get stable numeric IDs.
 *
 * ── ID assignment ─────────────────────────────────────────────────────────────
 *
 *   New nodes/edges from VueFlow arrive with UUID string IDs.
 *   On save, the facade assigns sequential externalKeys within their
 *   content type (STEP, STEP_LINK). The frontend re-fetches after save.
 *   Edge source/target references are matched by the UUID during the save
 *   transaction, then replaced with the new numeric IDs on re-fetch.
 *
 * ── Relations ─────────────────────────────────────────────────────────────────
 *
 *   PROCESS → TOPIC         content_item_relation (relationType='topic')
 *   PROCESS → USER_TYPE     content_item_relation (relationType='user_type')
 *   PROCESS → DOCUMENT_TYPE content_item_relation (relationType='document_type')
 *   STEP and STEP_LINK store processId in data_extra (no relation needed).
 */

import { inject, injectable, BindingScope } from '@loopback/core';
import { repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionTranslation,
} from '../models';
import { ProcessLegacy } from '../models/process-legacy.model';
import { ProcessFull } from '../models/process-full.model';
import { RevisionSummary } from '../models/revision-summary.model';
import {
    ProcessGraph,
    GraphNode,
    GraphEdge,
    type GraphNodeData,
    type GraphEdgeData,
    type GraphRequiredDocument,
} from '../models/process-graph.model';
import {
    type StepDataExtra,
    type RequiredDocument,
} from '../models/step-full.model';
import { type StepLinkDataExtra } from '../models/step-link-full.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
    ContentItemRelationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

// ── Content type codes ────────────────────────────────────────────────────────

const PROCESS_CODE = 'PROCESS';
const STEP_CODE = 'STEP';
const STEP_LINK_CODE = 'STEP_LINK';

// ── Relation types ────────────────────────────────────────────────────────────

const REL_TOPIC = 'topic';
const REL_USER_TYPE = 'user_type';
const REL_DOCUMENT_TYPE = 'document_type';

// ── System stamp for background operations ────────────────────────────────────

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system', username: 'system', name: 'System', realm: 'internal',
};

// ── List filter ───────────────────────────────────────────────────────────────

export interface ProcessListFilter {
    topicIds?: number[];
    userTypeIds?: number[];
    page?: number;
    pageSize?: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable({ scope: BindingScope.TRANSIENT })
export class ProcessFacadeService {
    constructor(
        @repository(ContentItemRepository)
        protected contentItemRepository: ContentItemRepository,

        @repository(ContentRevisionRepository)
        protected contentRevisionRepository: ContentRevisionRepository,

        @repository(ContentRevisionTranslationRepository)
        protected contentRevisionTranslationRepository: ContentRevisionTranslationRepository,

        @repository(ContentItemRelationRepository)
        protected contentItemRelationRepository: ContentItemRelationRepository,

        @inject(SecurityBindings.USER, { optional: true })
        protected currentUser: UserProfile | undefined,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,

        @inject(TranslationWorkflowOrchestratorService.BINDING, { optional: true })
        protected translationOrchestrator: TranslationWorkflowOrchestratorService | undefined,
    ) { }

    // ════════════════════════════════════════════════════════════════════════════
    // PROCESS CRUD
    // ════════════════════════════════════════════════════════════════════════════

    // ── List ──────────────────────────────────────────────────────────────────

    async find(filter: ProcessListFilter = {}): Promise<ProcessLegacy[]> {
        const { page = 1, pageSize = 20 } = filter;
        const items = await this.contentItemRepository.find({
            where: { typeCode: PROCESS_CODE },
            order: ['externalKey DESC'],
        });

        const result: ProcessLegacy[] = [];
        for (const item of items) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;

            const relations = await this.contentItemRelationRepository.find({
                where: { childItemId: item.id! },
            });
            const topicIds = await this.resolveExternalKeys(
                relations.filter(r => r.relationType === REL_TOPIC).map(r => r.parentItemId),
            );
            const userTypeIds = await this.resolveExternalKeys(
                relations.filter(r => r.relationType === REL_USER_TYPE).map(r => r.parentItemId),
            );
            const producedDocTypeIds = await this.resolveExternalKeys(
                relations.filter(r => r.relationType === REL_DOCUMENT_TYPE).map(r => r.parentItemId),
            );

            // AND filters
            if (filter.topicIds?.length) {
                if (!filter.topicIds.every(tid => topicIds.includes(tid))) continue;
            }
            if (filter.userTypeIds?.length) {
                if (!filter.userTypeIds.every(uid => userTypeIds.includes(uid))) continue;
            }

            // Count steps for this process
            const stepCount = await this.countStepsForProcess(Number(item.externalKey));

            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id!, lang: revision.sourceLang },
            });

            result.push(this.toLegacyDto(
                item, revision, sourceTr ?? undefined,
                topicIds, userTypeIds, producedDocTypeIds, stepCount,
            ));
        }

        const offset = (page - 1) * pageSize;
        return result.slice(offset, offset + pageSize);
    }

    async count(filter: ProcessListFilter = {}): Promise<{ count: number }> {
        const all = await this.find({ ...filter, page: 1, pageSize: Number.MAX_SAFE_INTEGER });
        return { count: all.length };
    }

    // ── Single item ───────────────────────────────────────────────────────────

    async findById(id: number): Promise<ProcessFull> {
        const item = await this.findItemByCodeAndIdOrFail(PROCESS_CODE, id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) throw new HttpErrors.NotFound(`No revision found for PROCESS ${id}`);

        const [translationRows, allRevisions, relations] = await Promise.all([
            this.contentRevisionTranslationRepository.find({ where: { revisionId: revision.id! } }),
            this.contentRevisionRepository.find({
                where: { itemId: item.id! },
                order: ['revisionNo ASC'],
                fields: { id: true, revisionNo: true, status: true, createdAt: true, createdBy: true, publishedAt: true },
            }),
            this.contentItemRelationRepository.find({ where: { childItemId: item.id! } }),
        ]);

        const topicIds = await this.resolveExternalKeys(
            relations.filter(r => r.relationType === REL_TOPIC).map(r => r.parentItemId),
        );
        const userTypeIds = await this.resolveExternalKeys(
            relations.filter(r => r.relationType === REL_USER_TYPE).map(r => r.parentItemId),
        );
        const producedDocTypeIds = await this.resolveExternalKeys(
            relations.filter(r => r.relationType === REL_DOCUMENT_TYPE).map(r => r.parentItemId),
        );

        return this.toFullDto(item, revision, translationRows, allRevisions, topicIds, userTypeIds, producedDocTypeIds);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create(input: {
        title?: string;
        description?: string;
        sourceLang?: string;
        topicIds?: number[];
        userTypeIds?: number[];
        producedDocTypeIds?: number[];
        translations?: Record<string, { title: string; description?: string }>;
    }): Promise<ProcessLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey(PROCESS_CODE));
        const sourceLang = input.sourceLang ?? 'it';

        const item = await this.contentItemRepository.create({
            typeCode: PROCESS_CODE,
            externalKey,
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: {},
            ...(stamp && { createdBy: stamp }),
        });

        const hasMap = input.translations && Object.keys(input.translations).length > 0;
        if (hasMap) {
            for (const [lang, content] of Object.entries(input.translations!)) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: revision.id!,
                    lang, title: content.title,
                    description: content.description ?? '', i18nExtra: {}, tStatus: 'DRAFT',
                });
            }
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId: revision.id!, lang: sourceLang,
                title: input.title ?? '', description: input.description ?? '',
                i18nExtra: {}, tStatus: 'DRAFT',
            });
        }

        await this.setRelations(item.id!, input.topicIds ?? [], input.userTypeIds ?? [], input.producedDocTypeIds ?? []);

        const srcTitle = hasMap
            ? (input.translations![sourceLang]?.title ?? input.title ?? '')
            : (input.title ?? '');

        this.logger.info('[ProcessFacadeService.create]', { externalKey, sourceLang });
        return this.toLegacyDto(item, revision,
            { lang: sourceLang, title: srcTitle, description: input.description ?? '' },
            input.topicIds ?? [], input.userTypeIds ?? [], input.producedDocTypeIds ?? [], 0,
        );
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    async replaceById(id: number, body: ProcessFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByCodeAndIdOrFail(PROCESS_CODE, id);
        const draft = await this.findOrCreateDraft(item, PROCESS_CODE);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        this.logger.info('[ProcessFacadeService.replaceById]', {
            id, status: body.status, sourceLang,
            langs: Object.keys(body.translations ?? {}),
        });

        await this.contentItemRepository.updateById(item.id!, { ...(stamp && { updatedBy: stamp }) });
        await this.contentRevisionRepository.updateById(draft.id!, { sourceLang });

        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, entry.title, entry.description ?? '', sourceLang);
        }

        if (body.status === 'APPROVED' && draft.status !== 'APPROVED') {
            await this.contentRevisionRepository.updateById(draft.id!, {
                status: 'APPROVED',
                approvedAt: new Date().toISOString(),
                ...(stamp && { approvedBy: stamp }),
            });
            await this.markNonSourceStale(draft.id!, sourceLang);
            await this.startTranslationWorkflow(item, draft, sourceLang);
        }

        // Replace all relations atomically
        if (body.topicIds !== undefined || body.userTypeIds !== undefined || body.producedDocTypeIds !== undefined) {
            await this.clearAllRelations(item.id!);
            await this.setRelations(
                item.id!,
                body.topicIds ?? [],
                body.userTypeIds ?? [],
                body.producedDocTypeIds ?? [],
            );
        }
    }

    // ── Partial update ────────────────────────────────────────────────────────

    async updateById(id: number, patch: { status?: ProcessLegacy['status']; sourceLang?: string }): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByCodeAndIdOrFail(PROCESS_CODE, id);
        const draft = await this.findOrCreateDraft(item, PROCESS_CODE);

        await this.contentItemRepository.updateById(item.id!, { ...(stamp && { updatedBy: stamp }) });

        if (patch.status !== undefined && patch.status !== draft.status) {
            const revUpdate: Record<string, unknown> = { status: patch.status };
            if (patch.status === 'APPROVED') {
                revUpdate['approvedAt'] = new Date().toISOString();
                if (stamp) revUpdate['approvedBy'] = stamp;
            }
            await this.contentRevisionRepository.updateById(draft.id!, revUpdate);
            if (patch.status === 'APPROVED') {
                await this.markNonSourceStale(draft.id!, draft.sourceLang);
                await this.startTranslationWorkflow(item, draft, draft.sourceLang);
            }
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByCodeAndIdOrFail(PROCESS_CODE, id);

        // Delete all steps and step-links belonging to this process
        const stepItems = await this.contentItemRepository.find({
            where: { typeCode: STEP_CODE },
        });
        for (const stepItem of stepItems) {
            const rev = await this.findPreferredRevision(stepItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepDataExtra> | undefined;
            if (extra?.processId !== id) continue;
            await this.contentItemRepository.deleteById(stepItem.id!);
        }

        const linkItems = await this.contentItemRepository.find({
            where: { typeCode: STEP_LINK_CODE },
        });
        for (const linkItem of linkItems) {
            const rev = await this.findPreferredRevision(linkItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepLinkDataExtra> | undefined;
            if (extra?.processId !== id) continue;
            await this.contentItemRepository.deleteById(linkItem.id!);
        }

        // Delete process relations and item itself
        await this.contentItemRelationRepository.deleteAll({ childItemId: item.id! });
        await this.contentItemRepository.deleteById(item.id!);

        this.logger.warn('[ProcessFacadeService.deleteById]', { id });
    }

    // ── Publish ───────────────────────────────────────────────────────────────

    async publish(id: number): Promise<void> {
        const stamp = buildActorStamp(this.currentUser) ?? SYSTEM_STAMP;
        const item = await this.findItemByCodeAndIdOrFail(PROCESS_CODE, id);

        const approved = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id!, status: 'APPROVED' },
            order: ['revisionNo DESC'],
        });
        if (!approved) {
            throw new HttpErrors.BadRequest(`No APPROVED revision for PROCESS ${id}`);
        }

        await this.contentRevisionRepository.updateById(approved.id!, {
            status: 'PUBLISHED',
            publishedAt: new Date().toISOString(),
            publishedBy: stamp,
        });
        await this.contentItemRepository.updateById(item.id!, {
            publishedRevisionId: approved.id!,
            updatedBy: stamp,
        });

        const prev = await this.contentRevisionRepository.find({
            where: { itemId: item.id!, status: 'PUBLISHED', id: { neq: approved.id! } },
        });
        for (const old of prev) {
            await this.contentRevisionRepository.updateById(old.id!, { status: 'ARCHIVED' });
        }

        // Also publish current DRAFT revisions for all steps and step-links
        // so they are available on the migrant frontend
        await this.publishGraphRevisions(id, stamp);

        this.logger.info('[ProcessFacadeService.publish]', { id });
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
        filter: ProcessListFilter = {},
    ): Promise<Array<Record<string, unknown>>> {
        const { page = 1, pageSize = 20 } = filter;
        const items = await this.contentItemRepository.find({
            where: { typeCode: PROCESS_CODE, publishedRevisionId: { neq: null as unknown as string } },
        });

        const result: Array<Record<string, unknown>> = [];
        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const relations = await this.contentItemRelationRepository.find({ where: { childItemId: item.id! } });
            const topicIds = await this.resolveExternalKeys(
                relations.filter(r => r.relationType === REL_TOPIC).map(r => r.parentItemId),
            );
            const userTypeIds = await this.resolveExternalKeys(
                relations.filter(r => r.relationType === REL_USER_TYPE).map(r => r.parentItemId),
            );

            if (filter.topicIds?.length && !filter.topicIds.every(tid => topicIds.includes(tid))) continue;
            if (filter.userTypeIds?.length && !filter.userTypeIds.every(uid => userTypeIds.includes(uid))) continue;

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: currentLang, tStatus: 'PUBLISHED' },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: defaultLang, tStatus: 'PUBLISHED' },
                }));
            if (!tr) continue;

            result.push({
                id: Number(item.externalKey),
                title: tr.title,
                description: tr.description,
                lang: tr.lang,
                topicIds,
                userTypeIds,
            });
        }

        const offset = (page - 1) * pageSize;
        return result.slice(offset, offset + pageSize);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // GRAPH MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════════

    /**
     * GET /processes/:id/graph
     *
     * Loads all STEP and STEP_LINK content items for the given processId,
     * transforms them to VueFlow-compatible Node[] and Edge[] objects.
     *
     * Steps and edges are loaded for the current (preferred) revision.
     * All translations are embedded in node/edge data for the step form.
     */
    async getGraph(processId: number): Promise<ProcessGraph> {
        // Verify process exists
        await this.findItemByCodeAndIdOrFail(PROCESS_CODE, processId);

        // Load all steps for this process
        const stepItems = await this.contentItemRepository.find({
            where: { typeCode: STEP_CODE },
        });

        const nodes: GraphNode[] = [];
        for (const stepItem of stepItems) {
            const rev = await this.findPreferredRevision(stepItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepDataExtra> | undefined;
            if (extra?.processId !== processId) continue;

            const trs = await this.contentRevisionTranslationRepository.find({
                where: { revisionId: rev.id! },
            });
            const translations: Record<string, { title: string; description?: string; tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
            for (const tr of trs) {
                translations[tr.lang] = {
                    title: tr.title,
                    description: tr.description ?? '',
                    tStatus: tr.tStatus as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE',
                };
            }
            const srcTr = trs.find(t => t.lang === rev.sourceLang);

            const nodeData: GraphNodeData = {
                title: srcTr?.title ?? '',
                description: srcTr?.description ?? '',
                status: rev.status as GraphNodeData['status'],
                sourceLang: rev.sourceLang,
                location: extra?.location ?? '',
                cost: extra?.cost ?? '',
                isFree: extra?.isFree ?? true,
                url: extra?.url ?? '',
                iconUrl: extra?.iconUrl ?? '',
                requiredDocuments: (extra?.requiredDocuments ?? []) as GraphRequiredDocument[],
                translations,
            };

            nodes.push(Object.assign(new GraphNode(), {
                id: String(stepItem.externalKey),
                type: 'step',
                position: { x: extra?.posX ?? 0, y: extra?.posY ?? 0 },
                data: nodeData,
            }));
        }

        // Load all step-links for this process
        const linkItems = await this.contentItemRepository.find({
            where: { typeCode: STEP_LINK_CODE },
        });

        const edges: GraphEdge[] = [];
        for (const linkItem of linkItems) {
            const rev = await this.findPreferredRevision(linkItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepLinkDataExtra> | undefined;
            if (extra?.processId !== processId) continue;

            const trs = await this.contentRevisionTranslationRepository.find({
                where: { revisionId: rev.id! },
            });
            const translations: Record<string, { title: string; tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
            for (const tr of trs) {
                translations[tr.lang] = {
                    title: tr.title,
                    tStatus: tr.tStatus as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE',
                };
            }
            const srcTr = trs.find(t => t.lang === rev.sourceLang);

            const edgeData: GraphEdgeData = {
                status: rev.status as GraphEdgeData['status'],
                sourceLang: rev.sourceLang,
                translations,
            };

            edges.push(Object.assign(new GraphEdge(), {
                id: String(linkItem.externalKey),
                source: String(extra?.sourceStepId ?? ''),
                target: String(extra?.targetStepId ?? ''),
                type: 'step-link',
                label: srcTr?.title ?? '',
                data: edgeData,
            }));
        }

        this.logger.info('[ProcessFacadeService.getGraph]', {
            processId, nodes: nodes.length, edges: edges.length,
        });

        return Object.assign(new ProcessGraph(), { nodes, edges });
    }

    /**
     * PUT /processes/:id/graph
     *
     * Atomically replaces the entire graph for a process:
     *   1. Delete all existing STEP content items for this processId
     *   2. Delete all existing STEP_LINK content items for this processId
     *   3. Insert all nodes from the payload as new STEP content items
     *   4. Insert all edges from the payload as new STEP_LINK content items
     *      (source/target are resolved from the node UUID→externalKey map)
     *
     * After save, the frontend re-fetches GET /graph to get stable IDs.
     */
    async saveGraph(processId: number, graph: ProcessGraph): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        await this.findItemByCodeAndIdOrFail(PROCESS_CODE, processId);

        // Step 1 & 2: Delete existing steps and step-links for this process
        await this.deleteGraphContent(processId);

        // Step 3: Insert nodes (steps)
        // Build a map from VueFlow UUID/ID → new externalKey for edge resolution
        const nodeIdMap = new Map<string, number>(); // vueflow id → new externalKey

        for (const node of graph.nodes) {
            const newExternalKey = await this.nextExternalKey(STEP_CODE);
            nodeIdMap.set(node.id, newExternalKey);

            const externalKeyStr = String(newExternalKey);
            const sourceLang = node.data.sourceLang ?? 'it';
            const dataExtra: Record<string, unknown> = {
                processId,
                posX: node.position.x,
                posY: node.position.y,
                location: node.data.location ?? '',
                cost: node.data.cost ?? '',
                isFree: node.data.isFree ?? true,
                url: node.data.url ?? '',
                iconUrl: node.data.iconUrl ?? '',
                requiredDocuments: node.data.requiredDocuments ?? [],
            };

            const stepItem = await this.contentItemRepository.create({
                typeCode: STEP_CODE,
                externalKey: externalKeyStr,
                ...(stamp && { createdBy: stamp, updatedBy: stamp }),
            });

            const stepRevision = await this.contentRevisionRepository.create({
                itemId: stepItem.id!,
                revisionNo: 1,
                status: node.data.status ?? 'DRAFT',
                sourceLang,
                dataExtra,
                ...(stamp && { createdBy: stamp }),
            });

            for (const [lang, entry] of Object.entries(node.data.translations ?? {})) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: stepRevision.id!,
                    lang,
                    title: entry.title ?? '',
                    description: entry.description ?? '',
                    i18nExtra: {},
                    tStatus: (entry.tStatus as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE') ?? 'DRAFT',
                });
            }

            // Ensure at least one translation row in sourceLang
            if (!node.data.translations?.[sourceLang]) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: stepRevision.id!,
                    lang: sourceLang,
                    title: node.data.title ?? '',
                    description: node.data.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }

        // Step 4: Insert edges (step-links)
        for (const edge of graph.edges) {
            // Resolve source/target to new externalKeys
            // VueFlow source/target may be old numeric IDs or new UUIDs
            const sourceId = nodeIdMap.get(edge.source) ?? Number(edge.source);
            const targetId = nodeIdMap.get(edge.target) ?? Number(edge.target);

            const newExternalKey = await this.nextExternalKey(STEP_LINK_CODE);
            const externalKeyStr = String(newExternalKey);
            const sourceLang = edge.data?.sourceLang ?? 'it';

            const dataExtra: Record<string, unknown> = {
                processId,
                sourceStepId: sourceId,
                targetStepId: targetId,
            };

            const linkItem = await this.contentItemRepository.create({
                typeCode: STEP_LINK_CODE,
                externalKey: externalKeyStr,
                ...(stamp && { createdBy: stamp, updatedBy: stamp }),
            });

            const linkRevision = await this.contentRevisionRepository.create({
                itemId: linkItem.id!,
                revisionNo: 1,
                status: edge.data?.status ?? 'DRAFT',
                sourceLang,
                dataExtra,
                ...(stamp && { createdBy: stamp }),
            });

            for (const [lang, entry] of Object.entries(edge.data?.translations ?? {})) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: linkRevision.id!,
                    lang,
                    title: entry.title ?? '',
                    description: '',
                    i18nExtra: {},
                    tStatus: (entry.tStatus as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE') ?? 'DRAFT',
                });
            }

            // Ensure at least one translation
            if (!edge.data?.translations?.[sourceLang]) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: linkRevision.id!,
                    lang: sourceLang,
                    title: edge.label ?? '',
                    description: '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }

        this.logger.info('[ProcessFacadeService.saveGraph]', {
            processId, nodes: graph.nodes.length, edges: graph.edges.length,
        });
    }

    // ════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ════════════════════════════════════════════════════════════════════════════

    // ── Translation workflow ──────────────────────────────────────────────────

    protected async startTranslationWorkflow(
        item: ContentItem,
        revision: ContentRevision,
        sourceLang: string,
    ): Promise<void> {
        if (!this.translationOrchestrator) return;
        try {
            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id!, lang: sourceLang },
            });
            if (!sourceTr) return;
            const fields: Record<string, string> = {};
            if (sourceTr.title?.trim()) fields['title'] = sourceTr.title;
            if (sourceTr.description?.trim()) fields['description'] = sourceTr.description;
            if (!Object.keys(fields).length) return;
            await this.translationOrchestrator.startRevisionFlow({
                revision, item, category: 'process', fields,
            });
        } catch (err) {
            this.logger.error('[ProcessFacadeService] startTranslationWorkflow failed', { err });
        }
    }

    protected async markNonSourceStale(revisionId: string, sourceLang: string): Promise<void> {
        const rows = await this.contentRevisionTranslationRepository.find({ where: { revisionId } });
        for (const row of rows) {
            if (row.lang !== sourceLang && row.tStatus === 'DRAFT') {
                await this.contentRevisionTranslationRepository.updateById(row.id!, { tStatus: 'STALE' });
            }
        }
    }

    // ── Relation management ───────────────────────────────────────────────────

    protected async setRelations(
        itemId: string,
        topicIds: number[],
        userTypeIds: number[],
        producedDocTypeIds: number[],
    ): Promise<void> {
        const createRel = async (parentExternalKey: number, relationType: string): Promise<void> => {
            const parentItem = await this.contentItemRepository.findOne({
                where: { externalKey: String(parentExternalKey) },
            });
            if (!parentItem) return;
            await this.contentItemRelationRepository.create({
                parentItemId: parentItem.id!, childItemId: itemId,
                relationType, sortOrder: 0, relationExtra: {},
            });
        };

        for (const tid of topicIds) await createRel(tid, REL_TOPIC);
        for (const uid of userTypeIds) await createRel(uid, REL_USER_TYPE);
        for (const did of producedDocTypeIds) await createRel(did, REL_DOCUMENT_TYPE);
    }

    protected async clearAllRelations(itemId: string): Promise<void> {
        await this.contentItemRelationRepository.deleteAll({ childItemId: itemId });
    }

    // ── Graph helpers ─────────────────────────────────────────────────────────

    protected async deleteGraphContent(processId: number): Promise<void> {
        // Delete STEPs for this process
        const stepItems = await this.contentItemRepository.find({ where: { typeCode: STEP_CODE } });
        for (const stepItem of stepItems) {
            const rev = await this.findPreferredRevision(stepItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepDataExtra> | undefined;
            if (extra?.processId !== processId) continue;
            await this.contentItemRepository.deleteById(stepItem.id!);
        }

        // Delete STEP_LINKs for this process
        const linkItems = await this.contentItemRepository.find({ where: { typeCode: STEP_LINK_CODE } });
        for (const linkItem of linkItems) {
            const rev = await this.findPreferredRevision(linkItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepLinkDataExtra> | undefined;
            if (extra?.processId !== processId) continue;
            await this.contentItemRepository.deleteById(linkItem.id!);
        }
    }

    protected async countStepsForProcess(processId: number): Promise<number> {
        const stepItems = await this.contentItemRepository.find({ where: { typeCode: STEP_CODE } });
        let count = 0;
        for (const stepItem of stepItems) {
            const rev = await this.findPreferredRevision(stepItem.id!);
            if (!rev) continue;
            const extra = rev.dataExtra as Partial<StepDataExtra> | undefined;
            if (extra?.processId === processId) count++;
        }
        return count;
    }

    protected async publishGraphRevisions(processId: number, stamp: ActorStamp): Promise<void> {
        for (const typeCode of [STEP_CODE, STEP_LINK_CODE]) {
            const items = await this.contentItemRepository.find({ where: { typeCode } });
            for (const item of items) {
                const rev = await this.findPreferredRevision(item.id!);
                if (!rev) continue;
                const extra = rev.dataExtra as Partial<StepDataExtra | StepLinkDataExtra> | undefined;
                if ((extra as Partial<StepDataExtra>)?.processId !== processId) continue;
                if (rev.status === 'DRAFT' || rev.status === 'APPROVED') {
                    await this.contentRevisionRepository.updateById(rev.id!, {
                        status: 'PUBLISHED',
                        publishedAt: new Date().toISOString(),
                        publishedBy: stamp,
                    });
                    await this.contentItemRepository.updateById(item.id!, {
                        publishedRevisionId: rev.id!, updatedBy: stamp,
                    });
                }
            }
        }
    }

    // ── Generic CRUD helpers ──────────────────────────────────────────────────

    /**
     * Insert or update a translation row.
     * sourceLang translation → tStatus APPROVED (authored text, no Weblate needed).
     * Other languages → tStatus DRAFT (awaiting Weblate workflow).
     */
    protected async upsertTranslation(
        revisionId: string, lang: string, title: string, description: string, sourceLang: string,
    ): Promise<void> {
        const tStatus = lang === sourceLang ? 'APPROVED' : 'DRAFT';
        const existing = await this.contentRevisionTranslationRepository.findOne({ where: { revisionId, lang } });
        if (existing) {
            await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                title, description, i18nExtra: {}, tStatus,
            });
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId, lang, title, description, i18nExtra: {}, tStatus,
            });
        }
    }

    protected async nextExternalKey(typeCode: string): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByCodeAndIdOrFail(typeCode: string, id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`${typeCode} ${id} not found`);
        return item;
    }

    protected async findPreferredRevision(itemId: string): Promise<ContentRevision | null> {
        for (const status of ['DRAFT', 'PUBLISHED', 'APPROVED'] as const) {
            const rev = await this.contentRevisionRepository.findOne({
                where: { itemId, status }, order: ['revisionNo DESC'],
            });
            if (rev) return rev;
        }
        return null;
    }

    protected async findOrCreateDraft(item: ContentItem, typeCode: string): Promise<ContentRevision> {
        const existing = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id!, status: 'DRAFT' },
        });
        if (existing) return existing;

        const latest = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id! }, order: ['revisionNo DESC'],
        });
        const stamp = buildActorStamp(this.currentUser);
        void typeCode; // used for logging context only

        const draft = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: latest ? latest.revisionNo + 1 : 1,
            status: 'DRAFT',
            sourceLang: latest?.sourceLang ?? 'it',
            dataExtra: latest?.dataExtra ?? {},
            ...(stamp && { createdBy: stamp }),
        });

        if (latest) {
            const rows = await this.contentRevisionTranslationRepository.find({ where: { revisionId: latest.id! } });
            for (const row of rows) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!, lang: row.lang,
                    title: row.title, description: row.description,
                    i18nExtra: row.i18nExtra ?? {},
                    tStatus: row.lang === draft.sourceLang ? 'DRAFT' : row.tStatus,
                });
            }
        }
        return draft;
    }

    protected async resolveExternalKeys(itemIds: string[]): Promise<number[]> {
        const result: number[] = [];
        for (const id of itemIds) {
            const item = await this.contentItemRepository.findById(id).catch(() => null);
            if (item?.externalKey) result.push(Number(item.externalKey));
        }
        return result;
    }

    // ── DTO mappers ───────────────────────────────────────────────────────────

    protected toLegacyDto(
        item: ContentItem,
        revision: ContentRevision,
        translation?: Partial<ContentRevisionTranslation>,
        topicIds?: number[],
        userTypeIds?: number[],
        producedDocTypeIds?: number[],
        stepCount?: number,
    ): ProcessLegacy {
        return Object.assign(new ProcessLegacy(), {
            id: Number(item.externalKey),
            title: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            topicIds: topicIds ?? [],
            userTypeIds: userTypeIds ?? [],
            producedDocTypeIds: producedDocTypeIds ?? [],
            stepCount: stepCount ?? 0,
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        allRevisions: ContentRevision[],
        topicIds: number[],
        userTypeIds: number[],
        producedDocTypeIds: number[],
    ): ProcessFull {
        const translations: Record<string, { title: string; description: string; tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
        for (const row of translationRows) {
            translations[row.lang] = {
                title: row.title,
                description: row.description ?? '',
                tStatus: row.tStatus as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE',
            };
        }
        const revisions: RevisionSummary[] = allRevisions.map(r =>
            Object.assign(new RevisionSummary(), {
                revisionNo: r.revisionNo, status: r.status, createdAt: r.createdAt,
                createdByName: (r.createdBy as { name?: string } | undefined)?.name ?? 'System',
                publishedAt: r.publishedAt,
            }),
        );
        return Object.assign(new ProcessFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            topicIds, userTypeIds, producedDocTypeIds,
            translations, revisions,
        });
    }
}