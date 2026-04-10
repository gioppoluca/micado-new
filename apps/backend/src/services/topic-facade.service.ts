/**
 * src/services/topic-facade.service.ts
 *
 * Facade for TOPIC content — bridges the generic Item/Revision/Translation/
 * Relation core to the consumer DTOs.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /topics                    → find()                  → TopicLegacy[]
 *   POST /topics                    → create()                → TopicLegacy
 *   GET  /topics/:id                → findById()              → TopicFull
 *   PUT  /topics/:id                → replaceById()           → 204
 *   PATCH /topics/:id               → updateById()            → 204
 *   DELETE /topics/:id              → deleteById()            → 204
 *   GET  /topics/to-production?id   → publish()               → 204
 *   GET  /topics-migrant            → getTranslatedForFrontend() → flat[]
 *
 * ── Parent-child relation ─────────────────────────────────────────────────────
 *
 *   Parent is stored as a content_item_relation with:
 *     relationType = 'parent'
 *     parentItemId = parent topic content_item.id  (UUID)
 *     childItemId  = this topic content_item.id    (UUID)
 *
 *   Constraints enforced by the facade:
 *   - A topic can have at most ONE parent (single-level select in the form).
 *   - A topic cannot be its own parent.
 *   - Cycles are prevented by checking the ancestor chain before linking.
 *
 *   On PUT, if parentId changes:
 *   - Existing parent relation is deleted.
 *   - New parent relation is created (if parentId is not null).
 *
 * ── Depth calculation ─────────────────────────────────────────────────────────
 *
 *   depth is 0-based: root = 0, child of root = 1, etc.
 *   Calculated lazily per item by walking the parent chain (N relations deep).
 *   Since max_depth is typically small (≤5), the extra queries are acceptable.
 *   If performance becomes a concern a recursive CTE can replace this.
 *
 * ── max_depth setting ─────────────────────────────────────────────────────────
 *
 *   The setting key 'topic.max_depth' in app_settings controls which nodes
 *   can be selected as a parent in the frontend tree picker.
 *   This facade does NOT enforce max_depth at write time — enforcement is
 *   presentational (frontend disables nodes beyond the limit).
 *   The value is NOT read by this service; it is served via /public/settings.
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
import { TopicLegacy } from '../models/topic-legacy.model';
import { TopicFull, RevisionSummary } from '../models/topic-full.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
    ContentItemRelationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const TOPIC_CODE = 'TOPIC';
const RELATION_PARENT = 'parent';

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system',
    username: 'system',
    name: 'System',
    realm: 'internal',
};

@injectable({ scope: BindingScope.TRANSIENT })
export class TopicFacadeService {
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

    // ── List ──────────────────────────────────────────────────────────────────

    async find(): Promise<TopicLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: TOPIC_CODE },
            order: ['externalKey ASC'],
        });

        const result: TopicLegacy[] = [];
        for (const item of items) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;
            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id, lang: revision.sourceLang },
            });
            const parentId = await this.getParentExternalKey(item.id!);
            const depth = await this.computeDepth(item.id!);
            result.push(this.toLegacyDto(item, revision, sourceTr ?? undefined, parentId, depth));
        }
        return result;
    }

    async count(): Promise<{ count: number }> {
        const result = await this.contentItemRepository.count({ typeCode: TOPIC_CODE });
        return { count: result.count };
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    async findById(id: number): Promise<TopicFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) {
            throw new HttpErrors.NotFound(`No revision found for TOPIC ${id}`);
        }

        const [translationRows, allRevisions] = await Promise.all([
            this.contentRevisionTranslationRepository.find({
                where: { revisionId: revision.id! },
            }),
            this.contentRevisionRepository.find({
                where: { itemId: item.id! },
                order: ['revisionNo ASC'],
                fields: { id: true, revisionNo: true, status: true, createdAt: true, createdBy: true, publishedAt: true },
            }),
        ]);

        const parentId = await this.getParentExternalKey(item.id!);
        const depth = await this.computeDepth(item.id!);

        return this.toFullDto(item, revision, translationRows, parentId, depth, allRevisions);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create(
        input: Omit<TopicLegacy, 'id' | 'status' | 'depth'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<TopicLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';

        const item = await this.contentItemRepository.create({
            typeCode: TOPIC_CODE,
            externalKey,
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: { ...(input.dataExtra ?? {}) },
            ...(stamp && { createdBy: stamp }),
        });

        const translationMap = input.translations ?? {};
        const hasMap = Object.keys(translationMap).length > 0;

        if (hasMap) {
            for (const [lang, content] of Object.entries(translationMap)) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: revision.id!,
                    lang,
                    title: content.title,
                    description: content.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId: revision.id!,
                lang: sourceLang,
                title: input.topic ?? '',
                description: input.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        // Set parent relation if provided
        if (input.parentId != null) {
            await this.setParentRelation(item.id!, input.parentId, stamp);
        }

        const sourceTr = hasMap
            ? translationMap[sourceLang]
            : { title: input.topic ?? '', description: input.description ?? '' };

        const depth = input.parentId != null ? await this.computeDepth(item.id!) : 0;

        return this.toLegacyDto(item, revision, {
            lang: sourceLang,
            title: sourceTr?.title ?? '',
            description: sourceTr?.description ?? '',
        }, input.parentId ?? null, depth);
    }

    // ── Full replace (form save) ──────────────────────────────────────────────

    async replaceById(id: number, body: TopicFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        this.logger.info('[TopicFacadeService.replaceById] entry', {
            id,
            itemId: item.id,
            draftId: draft.id,
            status: body.status,
            sourceLang,
            langCount: Object.keys(body.translations ?? {}).length,
            parentId: body.parentId,
        });

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: { ...(body.dataExtra ?? {}) },
        });

        // ── Document-level translations ────────────────────────────────────
        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, {
                title: entry.title,
                description: entry.description ?? '',
                i18nExtra: {},
            });
        }

        // ── Parent relation sync ───────────────────────────────────────────
        await this.syncParentRelation(item.id!, body.parentId ?? null, stamp);

        // ── DRAFT → APPROVED transition ────────────────────────────────────
        if (body.status === 'APPROVED' && draft.status !== 'APPROVED') {
            await this.contentRevisionRepository.updateById(draft.id!, {
                status: 'APPROVED',
                approvedAt: new Date().toISOString(),
                ...(stamp && { approvedBy: stamp }),
            });
            await this.markNonSourceTranslationsStale(draft.id!, sourceLang);
            await this.startTranslationWorkflow(item, draft, sourceLang);
        }
    }

    // ── Partial update ────────────────────────────────────────────────────────

    async updateById(id: number, patch: Partial<TopicLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.dataExtra !== undefined) {
            await this.contentRevisionRepository.updateById(draft.id!, {
                dataExtra: { ...(draft.dataExtra ?? {}), ...patch.dataExtra },
            });
        }

        if (patch.topic !== undefined || patch.description !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });
            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: patch.topic !== undefined ? patch.topic : existing.title,
                    description: patch.description !== undefined ? patch.description : existing.description,
                });
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!, lang,
                    title: patch.topic ?? '', description: patch.description ?? '',
                    i18nExtra: {}, tStatus: 'DRAFT',
                });
            }
        }

        if (patch.parentId !== undefined) {
            await this.syncParentRelation(item.id!, patch.parentId ?? null, stamp);
        }

        if (patch.status !== undefined && patch.status !== draft.status) {
            const revisionUpdate: Parameters<typeof this.contentRevisionRepository.updateById>[1] = {
                status: patch.status,
            };
            if (patch.status === 'APPROVED') {
                revisionUpdate.approvedAt = new Date().toISOString();
                if (stamp) revisionUpdate.approvedBy = stamp;
            }
            await this.contentRevisionRepository.updateById(draft.id!, revisionUpdate);
            if (patch.status === 'APPROVED') {
                await this.markNonSourceTranslationsStale(draft.id!, draft.sourceLang);
                await this.startTranslationWorkflow(item, draft, draft.sourceLang);
            }
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);

        // Guard: refuse to delete a topic that still has children
        const childRelations = await this.contentItemRelationRepository.find({
            where: { parentItemId: item.id!, relationType: RELATION_PARENT },
        });
        if (childRelations.length > 0) {
            throw new HttpErrors.Conflict(
                `Cannot delete TOPIC ${id}: it has ${childRelations.length} child topic(s). ` +
                `Reassign or delete child topics first.`,
            );
        }

        // Remove own parent relation (if any) before deleting the item
        const parentRelations = await this.contentItemRelationRepository.find({
            where: { childItemId: item.id!, relationType: RELATION_PARENT },
        });
        for (const rel of parentRelations) {
            await this.contentItemRelationRepository.deleteById(rel.id!);
        }

        await this.contentItemRepository.deleteById(item.id!);
    }

    // ── Publish ───────────────────────────────────────────────────────────────

    async publish(id: number): Promise<void> {
        const stamp = buildActorStamp(this.currentUser) ?? SYSTEM_STAMP;
        const item = await this.findItemByLegacyIdOrFail(id);

        const approved = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id!, status: 'APPROVED' },
            order: ['revisionNo DESC'],
        });
        if (!approved) {
            throw new HttpErrors.BadRequest(
                `No APPROVED revision available for TOPIC ${id}`,
            );
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

        // Archive previously PUBLISHED revisions
        const previouslyPublished = await this.contentRevisionRepository.find({
            where: { itemId: item.id!, status: 'PUBLISHED', id: { neq: approved.id! } },
        });
        for (const old of previouslyPublished) {
            await this.contentRevisionRepository.updateById(old.id!, { status: 'ARCHIVED' });
        }

        // Promote APPROVED translations to PUBLISHED
        const trs = await this.contentRevisionTranslationRepository.find({
            where: { revisionId: approved.id!, tStatus: 'APPROVED' },
        });
        for (const tr of trs) {
            await this.contentRevisionTranslationRepository.updateById(tr.id!, { tStatus: 'PUBLISHED' });
        }
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: TOPIC_CODE, publishedRevisionId: { neq: null as unknown as string } },
        });

        const result: Array<Record<string, unknown>> = [];
        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: currentLang, tStatus: 'PUBLISHED' },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: defaultLang, tStatus: 'PUBLISHED' },
                }));

            if (!tr) continue;

            const parentId = await this.getParentExternalKey(item.id!);
            const dataExtra = (await this.contentRevisionRepository.findById(item.publishedRevisionId)).dataExtra as Record<string, unknown>;

            result.push({
                id: Number(item.externalKey),
                topic: tr.title,
                description: tr.description,
                lang: tr.lang,
                icon: dataExtra?.icon ?? null,
                father: parentId,  // legacy field name
            });
        }
        return result;
    }

    // ── Parent relation helpers ───────────────────────────────────────────────

    /**
     * Returns the numeric external_key of the parent topic, or null if root.
     */
    protected async getParentExternalKey(itemId: string): Promise<number | null> {
        const rel = await this.contentItemRelationRepository.findOne({
            where: { childItemId: itemId, relationType: RELATION_PARENT },
        });
        if (!rel) return null;
        const parentItem = await this.contentItemRepository.findById(rel.parentItemId);
        const key = Number(parentItem.externalKey);
        return Number.isFinite(key) ? key : null;
    }

    /**
     * Computes 0-based depth by walking the parent chain.
     * Root = 0, first child = 1, etc.
     */
    protected async computeDepth(itemId: string): Promise<number> {
        let depth = 0;
        let currentId = itemId;
        // Guard against accidental cycles: cap at 20 levels
        for (let i = 0; i < 20; i++) {
            const rel = await this.contentItemRelationRepository.findOne({
                where: { childItemId: currentId, relationType: RELATION_PARENT },
            });
            if (!rel) break;
            depth++;
            currentId = rel.parentItemId;
        }
        return depth;
    }

    /**
     * Replaces the parent relation for a topic.
     * If newParentId is null, any existing parent relation is removed (topic becomes root).
     * Validates that the new parent is not a descendant of the current item (cycle prevention).
     */
    protected async syncParentRelation(
        itemId: string,
        newParentId: number | null,
        stamp: ActorStamp | undefined,
    ): Promise<void> {
        // Remove existing parent relation
        const existing = await this.contentItemRelationRepository.find({
            where: { childItemId: itemId, relationType: RELATION_PARENT },
        });
        for (const rel of existing) {
            await this.contentItemRelationRepository.deleteById(rel.id!);
        }

        if (newParentId == null) return;

        await this.setParentRelation(itemId, newParentId, stamp);
    }

    protected async setParentRelation(
        itemId: string,
        parentExternalKey: number,
        stamp: ActorStamp | undefined,
    ): Promise<void> {
        const parentItem = await this.contentItemRepository.findOne({
            where: { typeCode: TOPIC_CODE, externalKey: String(parentExternalKey) },
        });
        if (!parentItem) {
            throw new HttpErrors.UnprocessableEntity(
                `Parent TOPIC ${parentExternalKey} not found`,
            );
        }
        if (parentItem.id === itemId) {
            throw new HttpErrors.UnprocessableEntity('A topic cannot be its own parent');
        }

        // Cycle check: ensure parentItem is not a descendant of itemId
        await this.assertNotDescendant(itemId, parentItem.id!);

        await this.contentItemRelationRepository.create({
            parentItemId: parentItem.id!,
            childItemId: itemId,
            relationType: RELATION_PARENT,
            sortOrder: 0,
            relationExtra: {},
            ...(stamp && { createdBy: stamp }),
        });

        this.logger.info('[TopicFacadeService.setParentRelation] linked', {
            childItemId: itemId,
            parentItemId: parentItem.id,
            parentExternalKey,
        });
    }

    /**
     * Throws if candidateAncestorId is actually a descendant of rootId.
     * Prevents cycles when re-parenting.
     */
    protected async assertNotDescendant(
        rootId: string,
        candidateAncestorId: string,
    ): Promise<void> {
        // Walk all descendants of rootId and check if candidateAncestorId appears
        const visited = new Set<string>();
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);
            const children = await this.contentItemRelationRepository.find({
                where: { parentItemId: current, relationType: RELATION_PARENT },
            });
            for (const child of children) {
                if (child.childItemId === candidateAncestorId) {
                    throw new HttpErrors.UnprocessableEntity(
                        'Cannot set parent: would create a cycle in the topic hierarchy',
                    );
                }
                queue.push(child.childItemId);
            }
        }
    }

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
                revision, item,
                category: 'topics',
                fields,
            });
        } catch (err) {
            this.logger.error('[TopicFacadeService] startTranslationWorkflow failed', { err });
        }
    }

    protected async markNonSourceTranslationsStale(
        revisionId: string,
        sourceLang: string,
    ): Promise<void> {
        const rows = await this.contentRevisionTranslationRepository.find({ where: { revisionId } });
        for (const row of rows) {
            if (row.lang !== sourceLang && row.tStatus === 'DRAFT') {
                await this.contentRevisionTranslationRepository.updateById(row.id!, { tStatus: 'STALE' });
            }
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    protected async upsertTranslation(
        revisionId: string,
        lang: string,
        data: { title: string; description: string; i18nExtra: Record<string, unknown> },
    ): Promise<void> {
        const existing = await this.contentRevisionTranslationRepository.findOne({
            where: { revisionId, lang },
        });
        if (existing) {
            await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                title: data.title,
                description: data.description,
                i18nExtra: { ...(existing.i18nExtra ?? {}), ...data.i18nExtra },
                tStatus: 'DRAFT',
            });
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId, lang,
                title: data.title,
                description: data.description,
                i18nExtra: data.i18nExtra,
                tStatus: 'DRAFT',
            });
        }
    }

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: TOPIC_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: TOPIC_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`TOPIC ${id} not found`);
        return item;
    }

    protected async findPreferredRevision(itemId: string): Promise<ContentRevision | null> {
        for (const status of ['DRAFT', 'PUBLISHED', 'APPROVED'] as const) {
            const rev = await this.contentRevisionRepository.findOne({
                where: { itemId, status },
                order: ['revisionNo DESC'],
            });
            if (rev) return rev;
        }
        return null;
    }

    protected async findOrCreateDraft(item: ContentItem): Promise<ContentRevision> {
        const existing = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id!, status: 'DRAFT' },
        });
        if (existing) return existing;

        const latest = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id! },
            order: ['revisionNo DESC'],
        });
        const stamp = buildActorStamp(this.currentUser);

        const draft = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: latest ? latest.revisionNo + 1 : 1,
            status: 'DRAFT',
            sourceLang: latest?.sourceLang ?? 'it',
            dataExtra: latest?.dataExtra ?? {},
            ...(stamp && { createdBy: stamp }),
        });

        if (latest) {
            const rows = await this.contentRevisionTranslationRepository.find({
                where: { revisionId: latest.id! },
            });
            for (const row of rows) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!,
                    lang: row.lang,
                    title: row.title,
                    description: row.description,
                    i18nExtra: row.i18nExtra ?? {},
                    tStatus: row.lang === draft.sourceLang ? 'DRAFT' : row.tStatus,
                });
            }
        }
        return draft;
    }

    // ── DTO mappers ───────────────────────────────────────────────────────────

    protected toLegacyDto(
        item: ContentItem,
        revision: ContentRevision,
        translation?: Partial<ContentRevisionTranslation>,
        parentId?: number | null,
        depth?: number,
    ): TopicLegacy {
        return Object.assign(new TopicLegacy(), {
            id: Number(item.externalKey),
            topic: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
            parentId: parentId ?? null,
            depth: depth ?? 0,
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        parentId: number | null,
        depth: number,
        allRevisions: ContentRevision[] = [],
    ): TopicFull {
        const translations: Record<string, { title: string; description: string; tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
        for (const row of translationRows) {
            translations[row.lang] = {
                title: row.title,
                description: row.description ?? '',
                tStatus: row.tStatus,
            };
        }

        const revisions: RevisionSummary[] = allRevisions.map(r =>
            Object.assign(new RevisionSummary(), {
                revisionNo: r.revisionNo,
                status: r.status,
                createdAt: r.createdAt,
                createdByName: (r.createdBy as { name?: string } | undefined)?.name ?? 'System',
                publishedAt: r.publishedAt,
            }),
        );

        return Object.assign(new TopicFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
            parentId,
            depth,
            translations,
            revisions,
        });
    }
}