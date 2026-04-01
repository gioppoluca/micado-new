/**
 * src/services/document-type-facade.service.ts
 *
 * Facade for DOCUMENT_TYPE content — bridges the generic Item/Revision/
 * Translation/Relation core to the consumer DTOs.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /document-types          → find()
 *   POST /document-types          → create()
 *   GET  /document-types/:id      → findById()       ← rich, all relations
 *   PUT  /document-types/:id      → replaceById()    ← full diff (hotspots, validators)
 *   PATCH /document-types/:id     → updateById()
 *   DELETE /document-types/:id    → deleteById()
 *   GET  /document-types-migrant  → getTranslatedForFrontend()
 *   GET  /document-types/to-production?id → publish()
 *
 * ── Relation types used ──────────────────────────────────────────────────────
 *
 *   'hotspot'   parent=DOCUMENT_TYPE  child=PICTURE_HOTSPOT
 *               relation_extra = { picture_id: string, x: number, y: number }
 *               sort_order = hotspot display order
 *
 *   'validator' parent=DOCUMENT_TYPE  child=TENANT
 *               relation_extra = {}
 *               sort_order = 0
 *
 * ── Pictures ─────────────────────────────────────────────────────────────────
 *
 *   Stored as data_extra.pictures[] — pure JSONB, no DB rows.
 *   Each picture has a stable UUID generated once by the facade.
 *   This UUID is used as picture_id in hotspot relation_extra entries.
 *   The facade validates that every hotspot.pictureId references an id
 *   present in data_extra.pictures[] at write time.
 */

import { inject, injectable, BindingScope } from '@loopback/core';
import { Filter, repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { v4 as uuidv4 } from 'uuid';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionTranslation,
} from '../models';
import { DocumentTypeLegacy } from '../models/document-type-legacy.model';
import {
    DocumentTypeFull,
    DocumentHotspot,
    HotspotTranslationEntry,
    RevisionSummary,
} from '../models/document-type-full.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
    ContentItemRelationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const DOCUMENT_TYPE_CODE = 'DOCUMENT_TYPE';
const PICTURE_HOTSPOT_CODE = 'PICTURE_HOTSPOT';
const RELATION_HOTSPOT = 'hotspot';
const RELATION_VALIDATOR = 'validator';

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system',
    username: 'system',
    name: 'System',
    realm: 'internal',
};

@injectable({ scope: BindingScope.TRANSIENT })
export class DocumentTypeFacadeService {
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

    async find(_filter?: Filter<DocumentTypeLegacy>): Promise<DocumentTypeLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: DOCUMENT_TYPE_CODE },
            order: ['externalKey ASC'],
        });

        const result: DocumentTypeLegacy[] = [];
        for (const item of items) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;
            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id, lang: revision.sourceLang },
            });
            result.push(this.toLegacyDto(item, revision, sourceTr ?? undefined));
        }
        return result;
    }

    async count(where?: Record<string, unknown>): Promise<{ count: number }> {
        const mappedWhere: Record<string, unknown> = { typeCode: DOCUMENT_TYPE_CODE };
        if (where?.id != null) mappedWhere.externalKey = String(where.id);
        const result = await this.contentItemRepository.count(mappedWhere);
        return { count: result.count };
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    /**
     * Assembles DocumentTypeFull in parallel:
     *   1. content_revision + translations (document-level)
     *   2. content_item_relation 'hotspot' rows → PICTURE_HOTSPOT items + their translations
     *   3. content_item_relation 'validator' rows → validatorIds[]
     *   4. all revision summaries for version history panel
     */
    async findById(id: number): Promise<DocumentTypeFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) {
            throw new HttpErrors.NotFound(`No revision found for DOCUMENT_TYPE ${id}`);
        }

        const [translationRows, hotspotRelations, validatorRelations, allRevisions] =
            await Promise.all([
                this.contentRevisionTranslationRepository.find({
                    where: { revisionId: revision.id! },
                }),
                this.contentItemRelationRepository.find({
                    where: { parentItemId: item.id!, relationType: RELATION_HOTSPOT },
                    order: ['sortOrder ASC'],
                }),
                this.contentItemRelationRepository.find({
                    where: { parentItemId: item.id!, relationType: RELATION_VALIDATOR },
                }),
                this.contentRevisionRepository.find({
                    where: { itemId: item.id! },
                    order: ['revisionNo ASC'],
                    fields: { id: true, revisionNo: true, status: true, createdAt: true, createdBy: true, publishedAt: true },
                }),
            ]);

        // Load each hotspot's preferred revision + translations
        const hotspots: DocumentHotspot[] = [];
        for (const rel of hotspotRelations) {
            const hotspotItem = await this.contentItemRepository.findById(rel.childItemId);
            const hotspotRevision = await this.findPreferredRevision(hotspotItem.id!);
            if (!hotspotRevision) continue;

            const hotspotTrs = await this.contentRevisionTranslationRepository.find({
                where: { revisionId: hotspotRevision.id! },
            });

            const translations: DocumentHotspot['translations'] = {};
            for (const tr of hotspotTrs) {
                translations[tr.lang] = Object.assign(new HotspotTranslationEntry(), {
                    title: tr.title,
                    message: (tr.i18nExtra as { message?: string })?.message ?? '',
                    tStatus: tr.tStatus,
                });
            }

            const extra = rel.relationExtra as { picture_id?: string; x?: number; y?: number };
            hotspots.push(
                Object.assign(new DocumentHotspot(), {
                    id: hotspotItem.id,
                    pictureId: extra.picture_id ?? '',
                    x: extra.x ?? 0,
                    y: extra.y ?? 0,
                    sortOrder: rel.sortOrder,
                    translations,
                }),
            );
        }

        const validatorIds = validatorRelations.map(r => r.childItemId);

        return this.toFullDto(item, revision, translationRows, hotspots, validatorIds, allRevisions);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Creates item + revision + source translation.
     * pictures[] in dataExtra are stored as-is; each must already have
     * a stable UUID (the frontend generates them, or the facade can assign them).
     * Hotspots are not accepted at create time — use PUT after creation.
     */
    async create(
        input: Omit<DocumentTypeLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<DocumentTypeLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';

        // Ensure every picture in the incoming array has a stable UUID
        const rawDataExtra = (input.dataExtra ?? {}) as Record<string, unknown>;
        const pictures = this.ensurePictureIds(
            (rawDataExtra.pictures as Array<Record<string, unknown>> | undefined) ?? [],
        );

        const item = await this.contentItemRepository.create({
            typeCode: DOCUMENT_TYPE_CODE,
            externalKey,
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: { validable: false, ...rawDataExtra, pictures },
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
                title: input.document ?? '',
                description: input.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        const sourceTr = hasMap
            ? translationMap[sourceLang]
            : { title: input.document ?? '', description: input.description ?? '' };

        return this.toLegacyDto(item, revision, {
            lang: sourceLang,
            title: sourceTr?.title ?? '',
            description: sourceTr?.description ?? '',
        });
    }

    // ── Full replace (form save) ──────────────────────────────────────────────

    /**
     * Full replace: metadata, document translations, hotspots, validators.
     *
     * Hotspot diff:
     *   - id present in payload + in DB  → update relation_extra + translations
     *   - id absent from payload         → delete relation + content_item
     *   - id missing (new pin)           → create PICTURE_HOTSPOT content_item + relation
     *
     * Validator diff: full replace (delete all existing, insert from validatorIds).
     *
     * DRAFT→APPROVED transition:
     *   - revision.status → APPROVED
     *   - non-source translations (document + all hotspots) → STALE
     *   - translation workflow started
     */
    async replaceById(id: number, body: DocumentTypeFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        this.logger.info('[DocumentTypeFacadeService.replaceById] entry', {
            id,
            itemId: item.id,
            draftId: draft.id,
            status: body.status,
            sourceLang,
            langCount: Object.keys(body.translations ?? {}).length,
            hotspotCount: (body.hotspots ?? []).length,
            validatorCount: (body.validatorIds ?? []).length,
            pictureCount: ((body.dataExtra?.pictures ?? []) as unknown[]).length,
        });

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        // ── data_extra: ensure picture UUIDs are stable ────────────────────
        const rawDataExtra = (body.dataExtra ?? {}) as Record<string, unknown>;
        const pictures = this.ensurePictureIds(
            (rawDataExtra.pictures as Array<Record<string, unknown>> | undefined) ?? [],
        );

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: { validable: false, ...rawDataExtra, pictures },
        });

        // ── Document-level translations ────────────────────────────────────
        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, {
                title: entry.title,
                description: entry.description ?? '',
                i18nExtra: {},
            });
        }

        // ── Hotspot diff ───────────────────────────────────────────────────
        this.logger.info('[DocumentTypeFacadeService.replaceById] calling syncHotspots', {
            id,
            incomingHotspots: (body.hotspots ?? []).map(h => ({
                id: h.id ?? null,
                pictureId: h.pictureId,
                x: h.x,
                y: h.y,
                langs: Object.keys(h.translations ?? {}),
            })),
        });
        await this.syncHotspots(item, draft, sourceLang, body.hotspots ?? [], stamp);
        this.logger.info('[DocumentTypeFacadeService.replaceById] syncHotspots complete', { id });

        // ── Validator diff ─────────────────────────────────────────────────
        await this.syncValidators(item, body.validatorIds ?? [], stamp);

        // ── DRAFT → APPROVED transition ────────────────────────────────────
        if (body.status === 'APPROVED' && draft.status !== 'APPROVED') {
            await this.contentRevisionRepository.updateById(draft.id!, {
                status: 'APPROVED',
                approvedAt: new Date().toISOString(),
                ...(stamp && { approvedBy: stamp }),
            });
            await this.markNonSourceTranslationsStale(draft.id!, sourceLang);
            await this.markHotspotTranslationsStale(item.id!, sourceLang);
            await this.startTranslationWorkflow(item, draft, sourceLang);
        }
    }

    // ── Partial update ────────────────────────────────────────────────────────

    async updateById(id: number, patch: Partial<DocumentTypeLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.dataExtra !== undefined) {
            const merged = { ...(draft.dataExtra ?? {}), ...patch.dataExtra } as Record<string, unknown>;
            // Preserve existing pictures if patch doesn't include them
            if (!patch.dataExtra.pictures && draft.dataExtra?.pictures) {
                merged.pictures = (draft.dataExtra as Record<string, unknown>).pictures;
            }
            await this.contentRevisionRepository.updateById(draft.id!, { dataExtra: merged });
        }

        if (patch.document !== undefined || patch.description !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });
            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: patch.document !== undefined ? patch.document : existing.title,
                    description: patch.description !== undefined ? patch.description : existing.description,
                });
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!, lang,
                    title: patch.document ?? '', description: patch.description ?? '',
                    i18nExtra: {}, tStatus: 'DRAFT',
                });
            }
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
                await this.markHotspotTranslationsStale(item.id!, draft.sourceLang);
                await this.startTranslationWorkflow(item, draft, draft.sourceLang);
            }
        }
    }

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        // Cascade: delete hotspot content_items linked to this document
        const hotspotRelations = await this.contentItemRelationRepository.find({
            where: { parentItemId: item.id!, relationType: RELATION_HOTSPOT },
        });
        for (const rel of hotspotRelations) {
            await this.contentItemRepository.deleteById(rel.childItemId);
        }
        await this.contentItemRepository.deleteById(item.id!);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: DOCUMENT_TYPE_CODE, publishedRevisionId: { neq: undefined } },
        });

        const result: Array<Record<string, unknown>> = [];
        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const revision = await this.contentRevisionRepository.findById(item.publishedRevisionId);

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: currentLang, tStatus: 'PUBLISHED' },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: item.publishedRevisionId, lang: defaultLang, tStatus: 'PUBLISHED' },
                }));

            if (!tr) continue;

            // Spread data_extra so icon/issuer/validable/validity_duration are
            // at the root level — matching the legacy flat JOIN shape.
            // Strip pictures[] from the list response (images are heavy).
            const { pictures: _pics, ...dataExtraWithoutPictures } = (revision.dataExtra ?? {}) as Record<string, unknown>;

            result.push({
                id: Number(item.externalKey),
                document: tr.title,
                description: tr.description,
                lang: tr.lang,
                ...dataExtraWithoutPictures,
            });
        }
        return result;
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
                `No APPROVED revision available for DOCUMENT_TYPE ${id}`,
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

        // Archive all previously PUBLISHED revisions
        const previouslyPublished = await this.contentRevisionRepository.find({
            where: { itemId: item.id!, status: 'PUBLISHED', id: { neq: approved.id! } },
        });
        for (const old of previouslyPublished) {
            await this.contentRevisionRepository.updateById(old.id!, { status: 'ARCHIVED' });
        }

        // Promote APPROVED translation rows to PUBLISHED
        const trs = await this.contentRevisionTranslationRepository.find({
            where: { revisionId: approved.id!, tStatus: 'APPROVED' },
        });
        for (const tr of trs) {
            await this.contentRevisionTranslationRepository.updateById(tr.id!, { tStatus: 'PUBLISHED' });
        }

        // Publish hotspot translations as well
        const hotspotRelations = await this.contentItemRelationRepository.find({
            where: { parentItemId: item.id!, relationType: RELATION_HOTSPOT },
        });
        for (const rel of hotspotRelations) {
            const hotspotItem = await this.contentItemRepository.findById(rel.childItemId);
            if (!hotspotItem.publishedRevisionId) continue;
            const hotspotTrs = await this.contentRevisionTranslationRepository.find({
                where: { revisionId: hotspotItem.publishedRevisionId, tStatus: 'APPROVED' },
            });
            for (const htr of hotspotTrs) {
                await this.contentRevisionTranslationRepository.updateById(htr.id!, { tStatus: 'PUBLISHED' });
            }
        }
    }

    // ── Hotspot sync ──────────────────────────────────────────────────────────

    /**
     * Full diff between incoming hotspots[] and existing relation rows.
     *
     * Strategy:
     *   1. Load all existing 'hotspot' relations for this document item.
     *   2. Build a set of incoming ids (those that already have a UUID).
     *   3. Delete relations (and their child content_items) not in the set.
     *   4. For each incoming hotspot:
     *      - id present → update relation_extra + upsert translations
     *      - id absent  → create PICTURE_HOTSPOT content_item + relation + translations
     */
    protected async syncHotspots(
        docItem: ContentItem,
        docDraft: ContentRevision,
        sourceLang: string,
        incoming: DocumentHotspot[],
        stamp: ActorStamp | undefined,
    ): Promise<void> {
        const existingRelations = await this.contentItemRelationRepository.find({
            where: { parentItemId: docItem.id!, relationType: RELATION_HOTSPOT },
        });

        this.logger.info('[DocumentTypeFacadeService.syncHotspots] diff start', {
            docItemId: docItem.id,
            draftId: docDraft.id,
            existingCount: existingRelations.length,
            incomingCount: incoming.length,
            existingIds: existingRelations.map(r => r.childItemId),
            incomingIds: incoming.map(h => h.id ?? '(new)'),
        });

        const incomingIds = new Set(incoming.map(h => h.id).filter(Boolean));

        // Delete removed hotspots
        for (const rel of existingRelations) {
            if (!incomingIds.has(rel.childItemId)) {
                this.logger.info('[DocumentTypeFacadeService.syncHotspots] deleting removed hotspot', {
                    relationId: rel.id,
                    childItemId: rel.childItemId,
                });
                await this.contentItemRelationRepository.deleteById(rel.id!);
                await this.contentItemRepository.deleteById(rel.childItemId);
            }
        }

        // Create or update each incoming hotspot
        for (const hotspot of incoming) {
            const relationExtra = {
                picture_id: hotspot.pictureId,
                x: hotspot.x,
                y: hotspot.y,
            };

            if (hotspot.id) {
                // Existing hotspot — update relation_extra and sort_order
                const existingRel = existingRelations.find(r => r.childItemId === hotspot.id);
                if (existingRel) {
                    this.logger.info('[DocumentTypeFacadeService.syncHotspots] updating existing hotspot', {
                        hotspotId: hotspot.id,
                        relationId: existingRel.id,
                        x: hotspot.x, y: hotspot.y,
                        pictureId: hotspot.pictureId,
                        langs: Object.keys(hotspot.translations ?? {}),
                    });
                    await this.contentItemRelationRepository.updateById(existingRel.id!, {
                        relationExtra,
                        sortOrder: hotspot.sortOrder ?? existingRel.sortOrder,
                    });
                } else {
                    this.logger.warn('[DocumentTypeFacadeService.syncHotspots] hotspot.id present but no matching relation found — treating as orphan, skipping update', {
                        hotspotId: hotspot.id,
                    });
                }

                // Upsert translations on the hotspot's draft revision
                const hotspotItem = await this.contentItemRepository.findById(hotspot.id);
                const hotspotDraft = await this.findOrCreateHotspotDraft(hotspotItem, stamp);
                this.logger.info('[DocumentTypeFacadeService.syncHotspots] upserting translations for existing hotspot', {
                    hotspotId: hotspot.id,
                    hotspotDraftId: hotspotDraft.id,
                    langs: Object.keys(hotspot.translations ?? {}),
                    titles: Object.fromEntries(Object.entries(hotspot.translations ?? {}).map(([l, t]) => [l, t.title])),
                });
                await this.upsertHotspotTranslations(hotspotDraft.id!, hotspot.translations ?? {});
            } else {
                // New hotspot — create content_item + revision + translations + relation
                this.logger.info('[DocumentTypeFacadeService.syncHotspots] creating new hotspot', {
                    pictureId: hotspot.pictureId,
                    x: hotspot.x, y: hotspot.y,
                    langs: Object.keys(hotspot.translations ?? {}),
                });

                const hotspotItem = await this.contentItemRepository.create({
                    typeCode: PICTURE_HOTSPOT_CODE,
                    externalKey: String(await this.nextHotspotExternalKey()),
                    ...(stamp && { createdBy: stamp, updatedBy: stamp }),
                });

                const hotspotRevision = await this.contentRevisionRepository.create({
                    itemId: hotspotItem.id!,
                    revisionNo: 1,
                    status: 'DRAFT',
                    sourceLang,
                    dataExtra: {},
                    ...(stamp && { createdBy: stamp }),
                });

                this.logger.info('[DocumentTypeFacadeService.syncHotspots] hotspot content_item created', {
                    hotspotItemId: hotspotItem.id,
                    hotspotRevisionId: hotspotRevision.id,
                    langs: Object.keys(hotspot.translations ?? {}),
                });

                await this.upsertHotspotTranslations(hotspotRevision.id!, hotspot.translations ?? {});

                await this.contentItemRelationRepository.create({
                    parentItemId: docItem.id!,
                    childItemId: hotspotItem.id!,
                    relationType: RELATION_HOTSPOT,
                    sortOrder: hotspot.sortOrder ?? 0,
                    relationExtra,
                    ...(stamp && { createdBy: stamp }),
                });

                this.logger.info('[DocumentTypeFacadeService.syncHotspots] relation created', {
                    parentItemId: docItem.id,
                    childItemId: hotspotItem.id,
                    relationExtra,
                });
            }
        }

        this.logger.info('[DocumentTypeFacadeService.syncHotspots] diff complete', {
            docItemId: docItem.id,
            processedCount: incoming.length,
        });
    }

    /**
     * Upsert per-language translations for a hotspot revision.
     * title → title column.
     * message → i18n_extra.message (declared in PICTURE_HOTSPOT translation_schema).
     */
    protected async upsertHotspotTranslations(
        revisionId: string,
        translations: Record<string, { title: string; message?: string; tStatus?: string }>,
    ): Promise<void> {
        this.logger.debug('[DocumentTypeFacadeService.upsertHotspotTranslations]', {
            revisionId,
            langs: Object.keys(translations),
            entries: Object.fromEntries(
                Object.entries(translations).map(([l, t]) => [l, { title: t.title, message: t.message ?? '' }]),
            ),
        });
        for (const [lang, entry] of Object.entries(translations)) {
            await this.upsertTranslation(revisionId, lang, {
                title: entry.title,
                description: '',
                i18nExtra: { message: entry.message ?? '' },
            });
        }
    }

    // ── Validator sync ────────────────────────────────────────────────────────

    /**
     * Full replace of 'validator' relations for this document item.
     * Deletes all existing validator relations and re-creates from validatorIds.
     * Simple full-replace is safe here — validator assignment is a PA admin
     * action, not concurrent work like translations.
     */
    protected async syncValidators(
        docItem: ContentItem,
        validatorIds: string[],
        stamp: ActorStamp | undefined,
    ): Promise<void> {
        const existing = await this.contentItemRelationRepository.find({
            where: { parentItemId: docItem.id!, relationType: RELATION_VALIDATOR },
        });
        for (const rel of existing) {
            await this.contentItemRelationRepository.deleteById(rel.id!);
        }
        for (const tenantItemId of validatorIds) {
            await this.contentItemRelationRepository.create({
                parentItemId: docItem.id!,
                childItemId: tenantItemId,
                relationType: RELATION_VALIDATOR,
                sortOrder: 0,
                relationExtra: {},
                ...(stamp && { createdBy: stamp }),
            });
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
                category: 'document-types',
                fields,
            });
        } catch (err) {
            this.logger.error('[DocumentTypeFacadeService] startTranslationWorkflow failed', { err });
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

    /**
     * When the document is approved, also mark non-source hotspot translations
     * as STALE — they depend on the same source content being frozen.
     */
    protected async markHotspotTranslationsStale(
        docItemId: string,
        sourceLang: string,
    ): Promise<void> {
        const hotspotRelations = await this.contentItemRelationRepository.find({
            where: { parentItemId: docItemId, relationType: RELATION_HOTSPOT },
        });
        for (const rel of hotspotRelations) {
            const hotspotItem = await this.contentItemRepository.findById(rel.childItemId);
            const hotspotDraft = await this.contentRevisionRepository.findOne({
                where: { itemId: hotspotItem.id!, status: 'DRAFT' },
            });
            if (!hotspotDraft) continue;
            await this.markNonSourceTranslationsStale(hotspotDraft.id!, sourceLang);
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

    /**
     * Ensures every picture in the array has a stable UUID.
     * Assigns a new uuid4 to any entry missing one.
     */
    protected ensurePictureIds(
        pictures: Array<Record<string, unknown>>,
    ): Array<Record<string, unknown>> {
        return pictures.map(p => ({
            ...p,
            id: (p.id as string | undefined) ?? uuidv4(),
        }));
    }

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: DOCUMENT_TYPE_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async nextHotspotExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: PICTURE_HOTSPOT_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: DOCUMENT_TYPE_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`DOCUMENT_TYPE ${id} not found`);
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
            dataExtra: latest?.dataExtra ?? { validable: false },
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

    /** Returns or creates a DRAFT revision for a PICTURE_HOTSPOT content_item. */
    protected async findOrCreateHotspotDraft(
        hotspotItem: ContentItem,
        stamp: ActorStamp | undefined,
    ): Promise<ContentRevision> {
        const existing = await this.contentRevisionRepository.findOne({
            where: { itemId: hotspotItem.id!, status: 'DRAFT' },
        });
        if (existing) return existing;

        const latest = await this.contentRevisionRepository.findOne({
            where: { itemId: hotspotItem.id! },
            order: ['revisionNo DESC'],
        });

        return this.contentRevisionRepository.create({
            itemId: hotspotItem.id!,
            revisionNo: latest ? latest.revisionNo + 1 : 1,
            status: 'DRAFT',
            sourceLang: latest?.sourceLang ?? 'it',
            dataExtra: {},
            ...(stamp && { createdBy: stamp }),
        });
    }

    // ── DTO mappers ───────────────────────────────────────────────────────────

    protected toLegacyDto(
        item: ContentItem,
        revision: ContentRevision,
        translation?: Partial<ContentRevisionTranslation>,
    ): DocumentTypeLegacy {
        return Object.assign(new DocumentTypeLegacy(), {
            id: Number(item.externalKey),
            document: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        hotspots: DocumentHotspot[],
        validatorIds: string[],
        allRevisions: ContentRevision[] = [],
    ): DocumentTypeFull {
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

        return Object.assign(new DocumentTypeFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
            translations,
            hotspots,
            validatorIds,
            revisions,
        });
    }
}