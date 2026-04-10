/**
 * src/services/category-facade.service.ts
 *
 * Facade for CATEGORY content items (event and information subtypes).
 *
 * A single content type code "CATEGORY" serves both event categories and
 * information categories, differentiated by data_extra.subtype.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /categories?subtype=        → find(subtype?)
 *   GET  /categories/count?subtype=  → count(subtype?)
 *   POST /categories                 → create()
 *   GET  /categories/to-production   → publish()       ← before /:id
 *   GET  /categories/:id             → findById()
 *   PUT  /categories/:id             → replaceById()
 *   PATCH /categories/:id            → updateById()
 *   DELETE /categories/:id           → deleteById()
 *   GET  /categories-migrant         → getTranslatedForFrontend()
 *
 * ── Subtype immutability ─────────────────────────────────────────────────────
 *
 *  The subtype is stored in content_revision.data_extra at creation time.
 *  PUT ignores any subtype in the request body — the value is preserved as-is.
 *
 * ── Delete guard ─────────────────────────────────────────────────────────────
 *
 *  A category that is referenced by content items via content_item_relation
 *  (relationType='category') CANNOT be deleted. The facade checks for
 *  existing relations before deletion and throws HTTP 409 if any are found.
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
import { CategoryLegacy } from '../models/category-legacy.model';
import { CategoryFull, CategoryTranslationEntry } from '../models/category-full.model';
import { RevisionSummary } from '../models/revision-summary.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
    ContentItemRelationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const CATEGORY_CODE = 'CATEGORY';

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system',
    username: 'system',
    name: 'System',
    realm: 'internal',
};

@injectable({ scope: BindingScope.TRANSIENT })
export class CategoryFacadeService {
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

    async find(subtype?: 'event' | 'information'): Promise<CategoryLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: CATEGORY_CODE },
            order: ['externalKey ASC'],
        });

        const result: CategoryLegacy[] = [];
        for (const item of items) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;

            // Filter by subtype if provided
            const itemSubtype = (revision.dataExtra as { subtype?: string } | undefined)?.subtype as
                'event' | 'information' | undefined;
            if (subtype && itemSubtype !== subtype) continue;

            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id, lang: revision.sourceLang },
            });
            result.push(this.toLegacyDto(item, revision, sourceTr ?? undefined));
        }
        return result;
    }

    async count(subtype?: 'event' | 'information'): Promise<{ count: number }> {
        const all = await this.find(subtype);
        return { count: all.length };
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    async findById(id: number): Promise<CategoryFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) throw new HttpErrors.NotFound(`No revision found for CATEGORY ${id}`);

        const [translationRows, allRevisions] = await Promise.all([
            this.contentRevisionTranslationRepository.find({ where: { revisionId: revision.id! } }),
            this.contentRevisionRepository.find({
                where: { itemId: item.id! },
                order: ['revisionNo ASC'],
                fields: { id: true, revisionNo: true, status: true, createdAt: true, createdBy: true, publishedAt: true },
            }),
        ]);

        return this.toFullDto(item, revision, translationRows, allRevisions);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create(input: {
        title?: string;
        sourceLang?: string;
        subtype: 'event' | 'information';
        translations?: Record<string, { title: string }>;
    }): Promise<CategoryLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';

        const item = await this.contentItemRepository.create({
            typeCode: CATEGORY_CODE,
            externalKey,
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: { subtype: input.subtype },
            ...(stamp && { createdBy: stamp }),
        });

        const hasMap = input.translations && Object.keys(input.translations).length > 0;
        if (hasMap) {
            for (const [lang, content] of Object.entries(input.translations!)) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: revision.id!,
                    lang,
                    title: content.title,
                    description: '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId: revision.id!,
                lang: sourceLang,
                title: input.title ?? '',
                description: '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        this.logger.info('[CategoryFacadeService.create]', {
            externalKey, sourceLang, subtype: input.subtype,
        });

        const srcTitle = hasMap
            ? (input.translations![sourceLang]?.title ?? input.title ?? '')
            : (input.title ?? '');

        return this.toLegacyDto(item, revision, { lang: sourceLang, title: srcTitle });
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    async replaceById(id: number, body: CategoryFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        // subtype is immutable — preserve existing value from data_extra
        const existingSubtype = (draft.dataExtra as { subtype?: string } | undefined)?.subtype ?? 'event';

        this.logger.info('[CategoryFacadeService.replaceById]', {
            id, itemId: item.id, draftId: draft.id,
            status: body.status, sourceLang,
            langCount: Object.keys(body.translations ?? {}).length,
        });

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: { subtype: existingSubtype },
        });

        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, entry.title);
        }

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

    async updateById(id: number, patch: Partial<CategoryLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.title !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });
            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: patch.title,
                });
            }
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

    /**
     * Deletes a category. Throws HTTP 409 if the category is still referenced
     * by any content item via a 'category' relation.
     */
    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);

        // Guard: check for existing category relations
        const usageCount = await this.contentItemRelationRepository.count({
            parentItemId: item.id!,
            relationType: 'category',
        });
        if (usageCount.count > 0) {
            throw new HttpErrors.Conflict(
                `Category ${id} cannot be deleted: it is still referenced by ${usageCount.count} content item(s). ` +
                `Remove the category from all events/information items first.`,
            );
        }

        await this.contentItemRepository.deleteById(item.id!);
        this.logger.warn('[CategoryFacadeService.deleteById]', { id, itemId: item.id });
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
            throw new HttpErrors.BadRequest(`No APPROVED revision available for CATEGORY ${id}`);
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

        // Archive previous PUBLISHED revisions
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

        this.logger.info('[CategoryFacadeService.publish]', { id, revisionId: approved.id });
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        subtype?: 'event' | 'information',
        defaultLang = 'it',
        currentLang = 'it',
    ): Promise<Array<{ id: number; title: string; lang: string; subtype: string }>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: CATEGORY_CODE, publishedRevisionId: { neq: null as unknown as string } },
        });

        const result: Array<{ id: number; title: string; lang: string; subtype: string }> = [];
        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const revision = await this.contentRevisionRepository.findById(item.publishedRevisionId).catch(() => null);
            if (!revision) continue;

            const itemSubtype = (revision.dataExtra as { subtype?: string } | undefined)?.subtype ?? 'event';
            if (subtype && itemSubtype !== subtype) continue;

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: currentLang, tStatus: 'PUBLISHED' },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: defaultLang, tStatus: 'PUBLISHED' },
                }));

            if (!tr) continue;
            result.push({ id: Number(item.externalKey), title: tr.title, lang: tr.lang, subtype: itemSubtype });
        }
        return result;
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
            if (!sourceTr?.title?.trim()) return;

            await this.translationOrchestrator.startRevisionFlow({
                revision, item,
                category: 'category',
                fields: { title: sourceTr.title },
            });
        } catch (err) {
            this.logger.error('[CategoryFacadeService] startTranslationWorkflow failed', { err });
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
        title: string,
    ): Promise<void> {
        const existing = await this.contentRevisionTranslationRepository.findOne({
            where: { revisionId, lang },
        });
        if (existing) {
            await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                title,
                description: '',
                tStatus: 'DRAFT',
            });
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId, lang, title,
                description: '', i18nExtra: {}, tStatus: 'DRAFT',
            });
        }
    }

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: CATEGORY_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: CATEGORY_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`CATEGORY ${id} not found`);
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
        const existingSubtype = (latest?.dataExtra as { subtype?: string } | undefined)?.subtype ?? 'event';

        const draft = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: latest ? latest.revisionNo + 1 : 1,
            status: 'DRAFT',
            sourceLang: latest?.sourceLang ?? 'it',
            dataExtra: { subtype: existingSubtype },
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
                    description: '',
                    i18nExtra: {},
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
    ): CategoryLegacy {
        const subtype = (revision.dataExtra as { subtype?: string } | undefined)?.subtype as
            'event' | 'information' | undefined;
        return Object.assign(new CategoryLegacy(), {
            id: Number(item.externalKey),
            title: translation?.title ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            subtype: subtype ?? 'event',
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        allRevisions: ContentRevision[] = [],
    ): CategoryFull {
        const translations: Record<string, { title: string; tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }> = {};
        for (const row of translationRows) {
            translations[row.lang] = { title: row.title, tStatus: row.tStatus };
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

        const subtype = (revision.dataExtra as { subtype?: string } | undefined)?.subtype as
            'event' | 'information' | undefined;

        return Object.assign(new CategoryFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            subtype: subtype ?? 'event',
            translations,
            revisions,
        });
    }
}