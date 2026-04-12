/**
 * src/services/event-facade.service.ts
 *
 * Facade for EVENT content items.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /events?subtype=event&categoryId=&topicIds[]=&userTypeIds[]=
 *              &page=&pageSize=               → find() — list with filters + pagination
 *   GET  /events/count?...                   → count()
 *   POST /events                             → create()
 *   GET  /events/to-production?id=           → publish()   ← before /:id
 *   GET  /events/:id                         → findById()  — rich, all translations
 *   PUT  /events/:id                         → replaceById()
 *   PATCH /events/:id                        → updateById()  — status / metadata patch
 *   DELETE /events/:id                       → deleteById()
 *   GET  /events-migrant?defaultlang=&currentlang=
 *              &categoryId=&topicIds[]=&userTypeIds[]=
 *              &page=&pageSize=              → getTranslatedForFrontend()  (public)
 *
 * ── Filters ──────────────────────────────────────────────────────────────────
 *
 *   All filters are AND-combined:
 *     categoryId  — events linked to this CATEGORY content item
 *     topicIds    — events linked to ALL specified TOPIC content items
 *     userTypeIds — events linked to ALL specified USER_TYPE content items
 *
 *   Pagination is page-based (1-indexed) with a configurable pageSize.
 *   Default: page=1, pageSize=20.
 *
 * ── Relation management ───────────────────────────────────────────────────────
 *
 *   All relations (category, topic, user_type) are stored in
 *   content_item_relation with relationType identifying the relation kind.
 *   On PUT the facade performs: delete all existing + insert new set.
 *   This "replace" strategy is safe because relation sets are small (<10).
 *
 * ── data_extra fields ────────────────────────────────────────────────────────
 *
 *   startDate  — ISO 8601 datetime string (required for new events)
 *   endDate    — ISO 8601 datetime string (required)
 *   location   — free-text venue / address (optional)
 *   cost       — cost string e.g. "€ 10" (null when isFree=true)
 *   isFree     — boolean, default true
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
import { EventLegacy } from '../models/event-legacy.model';
import { EventFull, EventDataExtra } from '../models/event-full.model';
import { RevisionSummary } from '../models/revision-summary.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
    ContentItemRelationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const EVENT_CODE = 'EVENT';
const REL_CATEGORY = 'category';
const REL_TOPIC = 'topic';
const REL_USER_TYPE = 'user_type';

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system', username: 'system', name: 'System', realm: 'internal',
};

export interface EventListFilter {
    categoryId?: number;
    topicIds?: number[];
    userTypeIds?: number[];
    page?: number;
    pageSize?: number;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class EventFacadeService {
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

    async find(filter: EventListFilter = {}): Promise<EventLegacy[]> {
        const { page = 1, pageSize = 20 } = filter;

        const allItems = await this.contentItemRepository.find({
            where: { typeCode: EVENT_CODE },
            order: ['externalKey DESC'],
        });

        // Resolve relations and apply filters
        const result: EventLegacy[] = [];
        for (const item of allItems) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;

            const relations = await this.contentItemRelationRepository.find({
                where: { childItemId: item.id! },
            });

            const catRelation = relations.find(r => r.relationType === REL_CATEGORY);
            const topicRelations = relations.filter(r => r.relationType === REL_TOPIC);
            const utRelations = relations.filter(r => r.relationType === REL_USER_TYPE);

            const categoryItemId = catRelation?.parentItemId;
            const topicItemIds = topicRelations.map(r => r.parentItemId);
            const utItemIds = utRelations.map(r => r.parentItemId);

            // Resolve external keys for relation filtering
            const categoryExternalKey = categoryItemId
                ? (await this.contentItemRepository.findById(categoryItemId).catch(() => null))?.externalKey
                : undefined;
            const categoryId = categoryExternalKey ? Number(categoryExternalKey) : null;

            const topicIds = await this.resolveExternalKeys(topicItemIds);
            const userTypeIds = await this.resolveExternalKeys(utItemIds);

            // Apply AND filters
            if (filter.categoryId !== undefined && categoryId !== filter.categoryId) continue;
            if (filter.topicIds?.length) {
                if (!filter.topicIds.every(tid => topicIds.includes(tid))) continue;
            }
            if (filter.userTypeIds?.length) {
                if (!filter.userTypeIds.every(uid => userTypeIds.includes(uid))) continue;
            }

            // Resolve category title for display
            let categoryTitle: string | undefined;
            if (categoryItemId) {
                const catItem = await this.contentItemRepository.findById(categoryItemId).catch(() => null);
                if (catItem) {
                    const catRev = await this.findPreferredRevision(catItem.id!);
                    if (catRev) {
                        const catTr = await this.contentRevisionTranslationRepository.findOne({
                            where: { revisionId: catRev.id!, lang: revision.sourceLang },
                        }) ?? await this.contentRevisionTranslationRepository.findOne({
                            where: { revisionId: catRev.id! },
                        });
                        categoryTitle = catTr?.title;
                    }
                }
            }

            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id!, lang: revision.sourceLang },
            });

            const dataExtra = revision.dataExtra as Partial<EventDataExtra> | undefined;

            result.push(this.toLegacyDto(
                item, revision, sourceTr ?? undefined,
                categoryId, categoryTitle, topicIds, userTypeIds,
                dataExtra,
            ));
        }

        // Server-side pagination (applied after filtering)
        const offset = (page - 1) * pageSize;
        return result.slice(offset, offset + pageSize);
    }

    async count(filter: EventListFilter = {}): Promise<{ count: number }> {
        // Re-use find() without pagination for accurate count
        const all = await this.find({ ...filter, page: 1, pageSize: Number.MAX_SAFE_INTEGER });
        return { count: all.length };
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    async findById(id: number): Promise<EventFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) throw new HttpErrors.NotFound(`No revision found for EVENT ${id}`);

        const [translationRows, allRevisions, relations] = await Promise.all([
            this.contentRevisionTranslationRepository.find({ where: { revisionId: revision.id! } }),
            this.contentRevisionRepository.find({
                where: { itemId: item.id! },
                order: ['revisionNo ASC'],
                fields: { id: true, revisionNo: true, status: true, createdAt: true, createdBy: true, publishedAt: true },
            }),
            this.contentItemRelationRepository.find({ where: { childItemId: item.id! } }),
        ]);

        const catRel = relations.find(r => r.relationType === REL_CATEGORY);
        const topicRels = relations.filter(r => r.relationType === REL_TOPIC);
        const utRels = relations.filter(r => r.relationType === REL_USER_TYPE);

        const catItem = catRel
            ? await this.contentItemRepository.findById(catRel.parentItemId).catch(() => null)
            : null;
        const catId = catItem ? Number(catItem.externalKey) : null;

        const topicIds = await this.resolveExternalKeys(topicRels.map(r => r.parentItemId));
        const userTypeIds = await this.resolveExternalKeys(utRels.map(r => r.parentItemId));

        return this.toFullDto(item, revision, translationRows, allRevisions, catId, topicIds, userTypeIds);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create(input: {
        title?: string;
        description?: string;
        sourceLang?: string;
        dataExtra?: Partial<EventDataExtra>;
        categoryId?: number | null;
        topicIds?: number[];
        userTypeIds?: number[];
        translations?: Record<string, { title: string; description?: string }>;
    }): Promise<EventLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';
        const dataExtra: Record<string, unknown> = {
            startDate: input.dataExtra?.startDate,
            endDate: input.dataExtra?.endDate,
            location: input.dataExtra?.location,
            cost: input.dataExtra?.cost ?? null,
            isFree: input.dataExtra?.isFree ?? true,
        };

        const item = await this.contentItemRepository.create({
            typeCode: EVENT_CODE,
            externalKey,
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra,
            ...(stamp && { createdBy: stamp }),
        });

        const hasMap = input.translations && Object.keys(input.translations).length > 0;
        if (hasMap) {
            for (const [lang, content] of Object.entries(input.translations!)) {
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
                title: input.title ?? '',
                description: input.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        // Set relations
        if (input.categoryId != null) {
            await this.setCategoryRelation(item.id!, input.categoryId);
        }
        if (input.topicIds?.length) {
            await this.setTopicRelations(item.id!, input.topicIds);
        }
        if (input.userTypeIds?.length) {
            await this.setUserTypeRelations(item.id!, input.userTypeIds);
        }

        const srcTitle = hasMap
            ? (input.translations![sourceLang]?.title ?? input.title ?? '')
            : (input.title ?? '');

        this.logger.info('[EventFacadeService.create]', {
            externalKey, sourceLang,
            categoryId: input.categoryId, topics: input.topicIds?.length ?? 0,
        });

        return this.toLegacyDto(item, revision,
            { lang: sourceLang, title: srcTitle, description: input.description ?? '' },
            input.categoryId ?? null, undefined, input.topicIds ?? [], input.userTypeIds ?? [],
            dataExtra,
        );
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    async replaceById(id: number, body: EventFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        this.logger.info('[EventFacadeService.replaceById]', {
            id, itemId: item.id, draftId: draft.id,
            status: body.status, sourceLang,
            langCount: Object.keys(body.translations ?? {}).length,
        });

        // Merge dataExtra (preserve existing fields if not provided)
        const existingExtra = draft.dataExtra as Partial<EventDataExtra> | undefined;
        const newExtra: Record<string, unknown> = {
            startDate: body.dataExtra?.startDate ?? existingExtra?.startDate,
            endDate: body.dataExtra?.endDate ?? existingExtra?.endDate,
            location: body.dataExtra?.location ?? existingExtra?.location,
            cost: body.dataExtra?.cost ?? existingExtra?.cost ?? null,
            isFree: body.dataExtra?.isFree ?? existingExtra?.isFree ?? true,
        };

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: newExtra,
        });

        // Upsert translations
        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, entry.title, entry.description ?? '', sourceLang);
        }

        // Handle APPROVED workflow
        if (body.status === 'APPROVED' && draft.status !== 'APPROVED') {
            await this.contentRevisionRepository.updateById(draft.id!, {
                status: 'APPROVED',
                approvedAt: new Date().toISOString(),
                ...(stamp && { approvedBy: stamp }),
            });
            await this.markNonSourceTranslationsStale(draft.id!, sourceLang);
            await this.startTranslationWorkflow(item, draft, sourceLang);
        }

        // Replace relations (delete all + re-insert)
        if (body.categoryId !== undefined) {
            await this.clearRelations(item.id!, REL_CATEGORY);
            if (body.categoryId !== null) {
                await this.setCategoryRelation(item.id!, body.categoryId);
            }
        }
        if (body.topicIds !== undefined) {
            await this.clearRelations(item.id!, REL_TOPIC);
            await this.setTopicRelations(item.id!, body.topicIds);
        }
        if (body.userTypeIds !== undefined) {
            await this.clearRelations(item.id!, REL_USER_TYPE);
            await this.setUserTypeRelations(item.id!, body.userTypeIds);
        }
    }

    // ── Partial update ────────────────────────────────────────────────────────

    async updateById(id: number, patch: {
        status?: EventLegacy['status'];
        sourceLang?: string;
        dataExtra?: Partial<EventDataExtra>;
    }): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.dataExtra) {
            const existing = draft.dataExtra as Partial<EventDataExtra> | undefined;
            await this.contentRevisionRepository.updateById(draft.id!, {
                dataExtra: { ...existing, ...patch.dataExtra } as Record<string, unknown>,
            });
        }

        if (patch.status !== undefined && patch.status !== draft.status) {
            const revUpdate: Record<string, unknown> = { status: patch.status };
            if (patch.status === 'APPROVED') {
                revUpdate['approvedAt'] = new Date().toISOString();
                if (stamp) revUpdate['approvedBy'] = stamp;
            }
            await this.contentRevisionRepository.updateById(draft.id!, revUpdate);
            if (patch.status === 'APPROVED') {
                await this.markNonSourceTranslationsStale(draft.id!, draft.sourceLang);
                await this.startTranslationWorkflow(item, draft, draft.sourceLang);
            }
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        // Cascade: delete all relations first
        await this.contentItemRelationRepository.deleteAll({ childItemId: item.id! });
        await this.contentItemRepository.deleteById(item.id!);
        this.logger.warn('[EventFacadeService.deleteById]', { id, itemId: item.id });
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
            throw new HttpErrors.BadRequest(`No APPROVED revision available for EVENT ${id}`);
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
        const prev = await this.contentRevisionRepository.find({
            where: { itemId: item.id!, status: 'PUBLISHED', id: { neq: approved.id! } },
        });
        for (const old of prev) {
            await this.contentRevisionRepository.updateById(old.id!, { status: 'ARCHIVED' });
        }

        // Promote APPROVED translations to PUBLISHED
        const trs = await this.contentRevisionTranslationRepository.find({
            where: { revisionId: approved.id!, tStatus: 'APPROVED' },
        });
        for (const tr of trs) {
            await this.contentRevisionTranslationRepository.updateById(tr.id!, { tStatus: 'PUBLISHED' });
        }

        this.logger.info('[EventFacadeService.publish]', { id, revisionId: approved.id });
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
        filter: EventListFilter = {},
    ): Promise<Array<Record<string, unknown>>> {
        const { page = 1, pageSize = 20 } = filter;

        const items = await this.contentItemRepository.find({
            where: { typeCode: EVENT_CODE, publishedRevisionId: { neq: null as unknown as string } },
        });

        const result: Array<Record<string, unknown>> = [];
        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const revision = await this.contentRevisionRepository
                .findById(item.publishedRevisionId).catch(() => null);
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
            const catRel = relations.find(r => r.relationType === REL_CATEGORY);
            const catItem = catRel
                ? await this.contentItemRepository.findById(catRel.parentItemId).catch(() => null)
                : null;
            const categoryId = catItem ? Number(catItem.externalKey) : null;

            // Apply filters
            if (filter.categoryId !== undefined && categoryId !== filter.categoryId) continue;
            if (filter.topicIds?.length) {
                if (!filter.topicIds.every(tid => topicIds.includes(tid))) continue;
            }
            if (filter.userTypeIds?.length) {
                if (!filter.userTypeIds.every(uid => userTypeIds.includes(uid))) continue;
            }

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: currentLang, tStatus: 'PUBLISHED' },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: defaultLang, tStatus: 'PUBLISHED' },
                }));
            if (!tr) continue;

            const dataExtra = revision.dataExtra as Partial<EventDataExtra> | undefined;
            result.push({
                id: Number(item.externalKey),
                title: tr.title,
                description: tr.description,
                lang: tr.lang,
                startDate: dataExtra?.startDate,
                endDate: dataExtra?.endDate,
                location: dataExtra?.location,
                cost: dataExtra?.cost,
                isFree: dataExtra?.isFree ?? true,
                categoryId,
                topicIds,
                userTypeIds,
            });
        }

        const offset = (page - 1) * pageSize;
        return result.slice(offset, offset + pageSize);
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
                revision, item, category: 'event', fields,
            });
        } catch (err) {
            this.logger.error('[EventFacadeService] startTranslationWorkflow failed', { err });
        }
    }

    protected async markNonSourceTranslationsStale(revisionId: string, sourceLang: string): Promise<void> {
        const rows = await this.contentRevisionTranslationRepository.find({ where: { revisionId } });
        for (const row of rows) {
            if (row.lang !== sourceLang && row.tStatus === 'DRAFT') {
                await this.contentRevisionTranslationRepository.updateById(row.id!, { tStatus: 'STALE' });
            }
        }
    }

    // ── Relation helpers ──────────────────────────────────────────────────────

    protected async setCategoryRelation(itemId: string, categoryId: number): Promise<void> {
        const catItem = await this.contentItemRepository.findOne({
            where: { externalKey: String(categoryId) },
        });
        if (!catItem) return;
        await this.contentItemRelationRepository.create({
            parentItemId: catItem.id!,
            childItemId: itemId,
            relationType: REL_CATEGORY,
            sortOrder: 0,
            relationExtra: {},
        });
    }

    protected async setTopicRelations(itemId: string, topicIds: number[]): Promise<void> {
        for (const topicId of topicIds) {
            const topicItem = await this.contentItemRepository.findOne({
                where: { externalKey: String(topicId) },
            });
            if (!topicItem) continue;
            await this.contentItemRelationRepository.create({
                parentItemId: topicItem.id!,
                childItemId: itemId,
                relationType: REL_TOPIC,
                sortOrder: 0,
                relationExtra: {},
            });
        }
    }

    protected async setUserTypeRelations(itemId: string, userTypeIds: number[]): Promise<void> {
        for (const utId of userTypeIds) {
            const utItem = await this.contentItemRepository.findOne({
                where: { externalKey: String(utId) },
            });
            if (!utItem) continue;
            await this.contentItemRelationRepository.create({
                parentItemId: utItem.id!,
                childItemId: itemId,
                relationType: REL_USER_TYPE,
                sortOrder: 0,
                relationExtra: {},
            });
        }
    }

    protected async clearRelations(itemId: string, relationType: string): Promise<void> {
        await this.contentItemRelationRepository.deleteAll({ childItemId: itemId, relationType });
    }

    protected async resolveExternalKeys(itemIds: string[]): Promise<number[]> {
        const result: number[] = [];
        for (const id of itemIds) {
            const item = await this.contentItemRepository.findById(id).catch(() => null);
            if (item?.externalKey) result.push(Number(item.externalKey));
        }
        return result;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * Insert or update a translation row.
     * sourceLang translation → tStatus APPROVED (authored text, no Weblate needed).
     * Other languages → tStatus DRAFT (awaiting Weblate workflow).
     */
    protected async upsertTranslation(
        revisionId: string, lang: string, title: string, description: string, sourceLang: string,
    ): Promise<void> {
        const tStatus = lang === sourceLang ? 'APPROVED' : 'DRAFT';
        const existing = await this.contentRevisionTranslationRepository.findOne({
            where: { revisionId, lang },
        });
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

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: EVENT_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: EVENT_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`EVENT ${id} not found`);
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

    protected async findOrCreateDraft(item: ContentItem): Promise<ContentRevision> {
        const existing = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id!, status: 'DRAFT' },
        });
        if (existing) return existing;

        const latest = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id! }, order: ['revisionNo DESC'],
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
                    revisionId: draft.id!, lang: row.lang,
                    title: row.title, description: row.description,
                    i18nExtra: row.i18nExtra ?? {}, tStatus: row.lang === draft.sourceLang ? 'DRAFT' : row.tStatus,
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
        categoryId?: number | null,
        categoryTitle?: string,
        topicIds?: number[],
        userTypeIds?: number[],
        dataExtra?: Partial<EventDataExtra>,
    ): EventLegacy {
        return Object.assign(new EventLegacy(), {
            id: Number(item.externalKey),
            title: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            startDate: dataExtra?.startDate,
            endDate: dataExtra?.endDate,
            location: dataExtra?.location,
            cost: dataExtra?.cost ?? null,
            isFree: dataExtra?.isFree ?? true,
            categoryId: categoryId ?? null,
            categoryTitle,
            topicIds: topicIds ?? [],
            userTypeIds: userTypeIds ?? [],
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        allRevisions: ContentRevision[],
        categoryId: number | null,
        topicIds: number[],
        userTypeIds: number[],
    ): EventFull {
        const translations: Record<string, {
            title: string; description: string;
            tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';
        }> = {};
        for (const row of translationRows) {
            translations[row.lang] = {
                title: row.title,
                description: row.description ?? '',
                tStatus: row.tStatus,
            };
        }

        const revisions: RevisionSummary[] = allRevisions.map(r =>
            Object.assign(new RevisionSummary(), {
                revisionNo: r.revisionNo, status: r.status, createdAt: r.createdAt,
                createdByName: (r.createdBy as { name?: string } | undefined)?.name ?? 'System',
                publishedAt: r.publishedAt,
            }),
        );

        const dataExtra = revision.dataExtra as Partial<EventDataExtra> | undefined;

        return Object.assign(new EventFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: {
                startDate: dataExtra?.startDate,
                endDate: dataExtra?.endDate,
                location: dataExtra?.location,
                cost: dataExtra?.cost ?? null,
                isFree: dataExtra?.isFree ?? true,
            },
            categoryId,
            topicIds,
            userTypeIds,
            translations,
            revisions,
        });
    }
}