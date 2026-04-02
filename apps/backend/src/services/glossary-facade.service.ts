/**
 * src/services/glossary-facade.service.ts
 *
 * Facade for GLOSSARY content — bridges the generic Item/Revision/
 * Translation core to the consumer DTOs.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /glossaries              → find()
 *   POST /glossaries              → create()
 *   GET  /glossaries/:id          → findById()       ← rich, all translations
 *   PUT  /glossaries/:id          → replaceById()    ← all translations
 *   PATCH /glossaries/:id         → updateById()     ← status toggle
 *   DELETE /glossaries/:id        → deleteById()
 *   GET  /glossaries/to-production?id → publish()
 *   GET  /glossaries-migrant      → getTranslatedForFrontend()
 *   GET  /glossary-items          → getForMentionPicker()
 *
 * ── Data shape ───────────────────────────────────────────────────────────────
 *
 *  content_item [GLOSSARY]
 *    content_revision
 *      data_extra: {}   ← always empty, no non-translatable metadata
 *      content_revision_translation (per lang)
 *        title          → term label
 *        description    → definition (Markdown via tiptap-markdown)
 *        i18n_extra: {} → empty
 *
 * ── Mention picker ────────────────────────────────────────────────────────────
 *
 *  getForMentionPicker() serves GET /glossary-items which the frontend
 *  micado-entities.api.ts already references. Returns published + draft items
 *  so translators can link to terms while editing content.
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
import { GlossaryLegacy } from '../models/glossary-legacy.model';
import { GlossaryFull, GlossaryTranslationEntry } from '../models/glossary-full.model';
import { RevisionSummary } from '../models/revision-summary.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const GLOSSARY_CODE = 'GLOSSARY';

const SYSTEM_STAMP: ActorStamp = {
    sub: 'system',
    username: 'system',
    name: 'System',
    realm: 'internal',
};

@injectable({ scope: BindingScope.TRANSIENT })
export class GlossaryFacadeService {
    constructor(
        @repository(ContentItemRepository)
        protected contentItemRepository: ContentItemRepository,

        @repository(ContentRevisionRepository)
        protected contentRevisionRepository: ContentRevisionRepository,

        @repository(ContentRevisionTranslationRepository)
        protected contentRevisionTranslationRepository: ContentRevisionTranslationRepository,

        @inject(SecurityBindings.USER, { optional: true })
        protected currentUser: UserProfile | undefined,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,

        @inject(TranslationWorkflowOrchestratorService.BINDING, { optional: true })
        protected translationOrchestrator: TranslationWorkflowOrchestratorService | undefined,
    ) { }

    // ── List ──────────────────────────────────────────────────────────────────

    async find(): Promise<GlossaryLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: GLOSSARY_CODE },
            order: ['externalKey ASC'],
        });

        const result: GlossaryLegacy[] = [];
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

    async count(): Promise<{ count: number }> {
        const result = await this.contentItemRepository.count({ typeCode: GLOSSARY_CODE });
        return { count: result.count };
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    async findById(id: number): Promise<GlossaryFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);
        if (!revision) {
            throw new HttpErrors.NotFound(`No revision found for GLOSSARY ${id}`);
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

        return this.toFullDto(item, revision, translationRows, allRevisions);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Creates item + revision + source translation.
     * The optional `translations` map allows bulk import (CSV row per call)
     * to persist all language content in a single POST.
     */
    async create(
        input: Omit<GlossaryLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<GlossaryLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';

        const item = await this.contentItemRepository.create({
            typeCode: GLOSSARY_CODE,
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
                title: input.title ?? '',
                description: input.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        const sourceTr = hasMap
            ? translationMap[sourceLang]
            : { title: input.title ?? '', description: input.description ?? '' };

        this.logger.info('[GlossaryFacadeService.create]', {
            externalKey, sourceLang, hasMap,
        });

        return this.toLegacyDto(item, revision, {
            lang: sourceLang,
            title: sourceTr?.title ?? '',
            description: sourceTr?.description ?? '',
        });
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    async replaceById(id: number, body: GlossaryFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);
        const sourceLang = body.sourceLang ?? draft.sourceLang;

        this.logger.info('[GlossaryFacadeService.replaceById]', {
            id, itemId: item.id, draftId: draft.id,
            status: body.status, sourceLang,
            langCount: Object.keys(body.translations ?? {}).length,
        });

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: {},
        });

        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            await this.upsertTranslation(draft.id!, lang, {
                title: entry.title,
                description: entry.description ?? '',
                i18nExtra: {},
            });
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

    async updateById(id: number, patch: Partial<GlossaryLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.title !== undefined || patch.description !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });
            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    ...(patch.title !== undefined && { title: patch.title }),
                    ...(patch.description !== undefined && { description: patch.description }),
                });
            }
        }

        if (patch.status !== undefined && patch.status !== draft.status) {
            const revUpdate: Parameters<typeof this.contentRevisionRepository.updateById>[1] = {
                status: patch.status,
            };
            if (patch.status === 'APPROVED') {
                revUpdate.approvedAt = new Date().toISOString();
                if (stamp) revUpdate.approvedBy = stamp;
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
        await this.contentItemRepository.deleteById(item.id!);
        this.logger.warn('[GlossaryFacadeService.deleteById]', { id, itemId: item.id });
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
                `No APPROVED revision available for GLOSSARY ${id}`,
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

        this.logger.info('[GlossaryFacadeService.publish]', { id, revisionId: approved.id });
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: GLOSSARY_CODE, publishedRevisionId: { neq: undefined } },
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

            result.push({
                id: Number(item.externalKey),
                title: tr.title,
                description: tr.description,
                lang: tr.lang,
            });
        }
        return result;
    }

    /**
     * Lightweight list for the RichTextEditor @-mention suggestion system.
     * Returns both PUBLISHED and DRAFT items so editors can cross-reference
     * terms while writing content.
     * Endpoint: GET /glossary-items (already referenced in micado-entities.api.ts)
     */
    async getForMentionPicker(
        defaultLang = 'it',
        currentLang = 'it',
        includeDraft = true,
    ): Promise<Array<{ id: number; title: string; lang: string; published: boolean }>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: GLOSSARY_CODE },
            order: ['externalKey ASC'],
        });

        const result: Array<{ id: number; title: string; lang: string; published: boolean }> = [];
        for (const item of items) {
            // Prefer published revision; fall back to draft if includeDraft
            const publishedRev = item.publishedRevisionId
                ? await this.contentRevisionRepository.findById(item.publishedRevisionId).catch(() => null)
                : null;

            const revisionId = publishedRev?.id ?? (includeDraft
                ? (await this.contentRevisionRepository.findOne({
                    where: { itemId: item.id!, status: 'DRAFT' },
                    order: ['revisionNo DESC'],
                }))?.id
                : undefined);

            if (!revisionId) continue;

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId, lang: currentLang },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId, lang: defaultLang },
                }));

            if (!tr) continue;

            result.push({
                id: Number(item.externalKey),
                title: tr.title,
                lang: tr.lang,
                published: item.publishedRevisionId != null,
            });
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
            if (!sourceTr) return;

            const fields: Record<string, string> = {};
            if (sourceTr.title?.trim()) fields['title'] = sourceTr.title;
            if (sourceTr.description?.trim()) fields['description'] = sourceTr.description;
            if (!Object.keys(fields).length) return;

            await this.translationOrchestrator.startRevisionFlow({
                revision, item,
                category: 'glossary',
                fields,
            });
        } catch (err) {
            this.logger.error('[GlossaryFacadeService] startTranslationWorkflow failed', { err });
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
                i18nExtra: data.i18nExtra,
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
            where: { typeCode: GLOSSARY_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: GLOSSARY_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`GLOSSARY ${id} not found`);
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
            dataExtra: {},
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
    ): GlossaryLegacy {
        return Object.assign(new GlossaryLegacy(), {
            id: Number(item.externalKey),
            title: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
        });
    }

    protected toFullDto(
        item: ContentItem,
        revision: ContentRevision,
        translationRows: ContentRevisionTranslation[],
        allRevisions: ContentRevision[] = [],
    ): GlossaryFull {
        const translations: Record<string, {
            title: string;
            description: string;
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
                revisionNo: r.revisionNo,
                status: r.status,
                createdAt: r.createdAt,
                createdByName: (r.createdBy as { name?: string } | undefined)?.name ?? 'System',
                publishedAt: r.publishedAt,
            }),
        );

        return Object.assign(new GlossaryFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            translations,
            revisions,
        });
    }
}