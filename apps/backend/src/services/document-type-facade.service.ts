/**
 * src/services/document-type-facade.service.ts
 *
 * Facade bridging the generic Item/Revision/Translation core to the two
 * consumer-specific DTOs for DOCUMENT_TYPE content:
 *
 *   DocumentTypeLegacy  — flat, lightweight; used by list (GET /document-types)
 *                         and create (POST /document-types). Contains only the
 *                         sourceLang translation so the list never pays a
 *                         per-language query cost.
 *
 *   DocumentTypeFull    — rich; used by single-item GET (/document-types/:id)
 *                         and PUT save (/document-types/:id). Contains ALL
 *                         per-language translation rows embedded in `translations`.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /document-types          → find()        → DocumentTypeLegacy[]  (list)
 *   POST /document-types          → create()      → DocumentTypeLegacy    (flat)
 *   GET  /document-types/:id      → findById()    → DocumentTypeFull      (form)
 *   PUT  /document-types/:id      → replaceById() → 204                   (save)
 *   PATCH /document-types/:id     → updateById()  → 204                   (toggle)
 *   DELETE /document-types/:id    → deleteById()  → 204
 *   GET  /document-types-migrant  → getTranslatedForFrontend()  (published, lang-resolved)
 *   GET  /document-types/to-production?id → publish()           (workflow action)
 *
 * ── dataExtra field mapping ───────────────────────────────────────────────────
 *
 *   Legacy column     → data_extra key
 *   ──────────────────────────────────
 *   icon (text)       → icon             (base64 data URI)
 *   issuer (varchar)  → issuer
 *   model (text)      → model_template   (renamed to avoid JS reserved word)
 *   validable (bool)  → validable        (required in legacy, defaults to false here)
 *   validity_duration → validity_duration
 *
 * ── Actor stamp ──────────────────────────────────────────────────────────────
 *
 *   Every write method calls buildActorStamp(this.currentUser) and writes the
 *   result to content_item.created_by / updated_by and content_revision.created_by
 *   / approved_by / published_by.  The stamp shape is { sub, username, name, realm }.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 *   TRANSIENT — a new instance per HTTP request so each instance holds its own
 *   currentUser. SINGLETON would share state across concurrent requests.
 */

import { inject, injectable, BindingScope } from '@loopback/core';
import { Filter, repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionTranslation,
} from '../models';
import { DocumentTypeLegacy } from '../models/document-type-legacy.model';
import { DocumentTypeFull, RevisionSummary } from '../models/document-type-full.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const DOCUMENT_TYPE_CODE = 'DOCUMENT_TYPE';

/**
 * Fallback stamp for background jobs / CLI contexts where no JWT is present.
 * Distinguishable from real users by sub='system'.
 */
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

        // Optional: facade still works in background contexts without a JWT.
        @inject(SecurityBindings.USER, { optional: true })
        protected currentUser: UserProfile | undefined,

        // Optional: the facade still works in test environments where DBOS is
        // not running.
        @inject(TranslationWorkflowOrchestratorService.BINDING, { optional: true })
        protected translationOrchestrator: TranslationWorkflowOrchestratorService | undefined,
    ) { }

    // ── List (lean) ───────────────────────────────────────────────────────────

    /**
     * Returns DocumentTypeLegacy[] ordered by externalKey (legacy id).
     * Each item carries only the sourceLang translation — no per-language overhead.
     */
    async find(_filter?: Filter<DocumentTypeLegacy>): Promise<DocumentTypeLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: DOCUMENT_TYPE_CODE },
            order: ['externalKey ASC'],
        });

        const result: DocumentTypeLegacy[] = [];

        for (const item of items) {
            const revision = await this.findPreferredRevision(item.id!);
            if (!revision) continue;

            const sourceTranslation =
                await this.contentRevisionTranslationRepository.findOne({
                    where: { revisionId: revision.id, lang: revision.sourceLang },
                });

            result.push(this.toLegacyDto(item, revision, sourceTranslation ?? undefined));
        }

        return result;
    }

    async count(where?: Record<string, unknown>): Promise<{ count: number }> {
        const mappedWhere: Record<string, unknown> = { typeCode: DOCUMENT_TYPE_CODE };
        if (where?.id != null) mappedWhere.externalKey = String(where.id);
        const result = await this.contentItemRepository.count(mappedWhere);
        return { count: result.count };
    }

    // ── Single item (rich — form open) ────────────────────────────────────────

    /**
     * Returns DocumentTypeFull with ALL per-language translations embedded
     * and the full version history panel data. One round-trip — the PA form
     * needs no second call.
     */
    async findById(id: number): Promise<DocumentTypeFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);

        if (!revision) {
            throw new HttpErrors.NotFound(`No revision found for DOCUMENT_TYPE ${id}`);
        }

        const [translationRows, allRevisions] = await Promise.all([
            this.contentRevisionTranslationRepository.find({
                where: { revisionId: revision.id! },
            }),
            // All revisions for the version history panel — metadata only, no
            // translation content. Ascending so the UI shows v1, v2, v3…
            this.contentRevisionRepository.find({
                where: { itemId: item.id! },
                order: ['revisionNo ASC'],
                fields: {
                    id: true,
                    revisionNo: true,
                    status: true,
                    createdAt: true,
                    createdBy: true,
                    publishedAt: true,
                },
            }),
        ]);

        return this.toFullDto(item, revision, translationRows, allRevisions);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Creates item + revision + translations in one sequence.
     *
     * Accepts an optional `translations` map so the PA form can send all
     * language content in the initial POST — no follow-up PUT needed for
     * new records.
     *
     * The `dataExtra` bag carries all non-translatable metadata
     * (icon, issuer, model_template, validable, validity_duration).
     *
     * Actor stamp written to:
     *   content_item.created_by     ← stamp
     *   content_item.updated_by     ← stamp (same at creation time)
     *   content_revision.created_by ← stamp
     */
    async create(
        input: Omit<DocumentTypeLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<DocumentTypeLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'it';

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
            // Ensure validable always has a value (required in legacy schema).
            dataExtra: {
                validable: false,
                ...input.dataExtra,
            },
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
            // Fallback: single sourceLang row from the flat `document` field.
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
     * Replaces the full document type — metadata (dataExtra) + all translations
     * — in one call. Used by PUT /document-types/:id (the PA form Save button).
     *
     * Languages absent from body.translations are NOT deleted — only upserted.
     * Concurrent translator work on other languages is always preserved.
     *
     * Handles DRAFT → APPROVED transition ("Send to translation" toggle):
     *   - revision.status      → APPROVED
     *   - revision.approved_at → now()
     *   - revision.approved_by → actor stamp
     *   - Non-source DRAFT translation rows → tStatus = 'STALE'
     *   - Translation workflow started via orchestrator
     *
     * Actor stamp written to:
     *   content_item.updated_by      ← stamp (every save)
     *   content_revision.approved_by ← stamp (only on DRAFT → APPROVED)
     *   content_revision.approved_at ← now() (same condition)
     */
    async replaceById(id: number, body: DocumentTypeFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        const sourceLang = body.sourceLang ?? draft.sourceLang;

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: {
                validable: false,           // safe default — body always overrides
                ...(body.dataExtra ?? {}),
            },
        });

        // Upsert all translations from the body
        for (const [lang, entry] of Object.entries(body.translations ?? {})) {
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });

            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: entry.title,
                    description: entry.description ?? '',
                    tStatus: 'DRAFT',
                });
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!,
                    lang,
                    title: entry.title,
                    description: entry.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }

        // Handle DRAFT → APPROVED transition
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

    // ── Partial update (status toggle, icon-only, etc.) ───────────────────────

    /**
     * Partial update — handles list-row status toggle and single-field patches
     * (e.g. icon update without re-sending all translations).
     * Does NOT touch translations.
     *
     * Actor stamp written to:
     *   content_item.updated_by      ← stamp (always)
     *   content_revision.approved_by ← stamp (only on DRAFT → APPROVED)
     *   content_revision.approved_at ← now() (same condition)
     */
    async updateById(id: number, patch: Partial<DocumentTypeLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        // Merge dataExtra patch (e.g. icon change, validable toggle)
        if (patch.dataExtra !== undefined) {
            await this.contentRevisionRepository.updateById(draft.id!, {
                dataExtra: { ...(draft.dataExtra ?? {}), ...patch.dataExtra },
            });
        }

        // Patch the source-language translation if flat text fields are sent
        if (patch.document !== undefined || patch.description !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });

            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: patch.document !== undefined ? patch.document : existing.title,
                    description: patch.description !== undefined
                        ? patch.description
                        : existing.description,
                });
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!,
                    lang,
                    title: patch.document ?? '',
                    description: patch.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }

        // Handle status transition
        if (patch.status !== undefined && patch.status !== draft.status) {
            const revisionUpdate: Parameters<
                typeof this.contentRevisionRepository.updateById
            >[1] = { status: patch.status };

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

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        await this.contentItemRepository.deleteById(item.id!);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * Returns published document types in the best available language for the
     * migrant frontend. Language resolution: currentLang → defaultLang.
     * Mirrors the legacy double-UNION SQL query with an in-process fallback.
     *
     * Response shape matches the legacy `document_type + document_type_translation_prod`
     * JOIN so the migrant frontend does not need changes.
     */
    async getTranslatedForFrontend(
        defaultLang = 'it',
        currentLang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: {
                typeCode: DOCUMENT_TYPE_CODE,
                publishedRevisionId: { neq: undefined },
            },
        });

        const result: Array<Record<string, unknown>> = [];

        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const revision = await this.contentRevisionRepository.findById(
                item.publishedRevisionId,
            );

            const tr =
                (await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: item.publishedRevisionId,
                        lang: currentLang,
                        tStatus: 'PUBLISHED',
                    },
                })) ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: item.publishedRevisionId,
                        lang: defaultLang,
                        tStatus: 'PUBLISHED',
                    },
                }));

            if (!tr) continue;

            // Return the flat shape the migrant frontend expects, including all
            // non-translatable metadata from data_extra.
            result.push({
                id: Number(item.externalKey),
                document: tr.title,
                description: tr.description,
                lang: tr.lang,
                // Spread data_extra fields so legacy consumers that read
                // icon / issuer / validable / validity_duration directly still work.
                ...(revision.dataExtra ?? {}),
            });
        }

        return result;
    }

    // ── Publish ───────────────────────────────────────────────────────────────

    /**
     * Promotes the APPROVED revision to PUBLISHED and sets it as the live
     * revision on content_item.published_revision_id.
     *
     * Enforces "only one PUBLISHED revision per item" by archiving any
     * previously PUBLISHED revision before promoting the new one.
     *
     * Actor stamp written to:
     *   content_revision.published_by ← stamp (or SYSTEM_STAMP)
     *   content_revision.published_at ← now()
     *   content_item.updated_by       ← stamp
     */
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

        // Promote to PUBLISHED
        await this.contentRevisionRepository.updateById(approved.id!, {
            status: 'PUBLISHED',
            publishedAt: new Date().toISOString(),
            publishedBy: stamp,
        });

        // Point content_item to the newly published revision
        await this.contentItemRepository.updateById(item.id!, {
            publishedRevisionId: approved.id!,
            updatedBy: stamp,
        });

        // Archive the previously PUBLISHED revision so only one is ever PUBLISHED
        const previouslyPublished = await this.contentRevisionRepository.find({
            where: {
                itemId: item.id!,
                status: 'PUBLISHED',
                id: { neq: approved.id! },
            },
        });
        for (const old of previouslyPublished) {
            await this.contentRevisionRepository.updateById(old.id!, {
                status: 'ARCHIVED',
            });
        }

        // Mark all APPROVED translation rows as PUBLISHED
        const translations = await this.contentRevisionTranslationRepository.find({
            where: { revisionId: approved.id!, tStatus: 'APPROVED' },
        });
        for (const tr of translations) {
            await this.contentRevisionTranslationRepository.updateById(tr.id!, {
                tStatus: 'PUBLISHED',
            });
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * Starts the DBOS translation workflow for a newly approved revision.
     * Reads the source translation row to extract title + description.
     * If the orchestrator is not injected (test env / DBOS not running), returns silently.
     * If the source translation row is missing or empty, returns silently.
     * Errors do NOT propagate — workflow failure must not fail the approval request.
     */
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

            if (Object.keys(fields).length === 0) return;

            await this.translationOrchestrator.startRevisionFlow({
                revision,
                item,
                category: 'document-types',  // matches weblate_namespace in content_type seed
                fields,
            });
        } catch (err) {
            // Log but do not re-throw: workflow start failure must not surface
            // to the PA operator as an HTTP 500.
            console.error('[DocumentTypeFacadeService] startTranslationWorkflow failed', err);
        }
    }

    /**
     * When a revision moves to APPROVED, all non-source DRAFT translation rows
     * are set to STALE to signal that the source text has been frozen.
     * Already APPROVED or PUBLISHED translation rows are left untouched.
     */
    protected async markNonSourceTranslationsStale(
        revisionId: string,
        sourceLang: string,
    ): Promise<void> {
        const rows = await this.contentRevisionTranslationRepository.find({
            where: { revisionId },
        });
        for (const row of rows) {
            if (row.lang !== sourceLang && row.tStatus === 'DRAFT') {
                await this.contentRevisionTranslationRepository.updateById(row.id!, {
                    tStatus: 'STALE',
                });
            }
        }
    }

    /** Derives the next external key by finding the current max and incrementing. */
    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: DOCUMENT_TYPE_CODE },
            fields: { externalKey: true },
        });
        return (
            items.reduce((acc, item) => {
                const n = Number(item.externalKey);
                return Number.isFinite(n) && n > acc ? n : acc;
            }, 0) + 1
        );
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: DOCUMENT_TYPE_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`DOCUMENT_TYPE ${id} not found`);
        return item;
    }

    /**
     * Priority: DRAFT > PUBLISHED > APPROVED > ARCHIVED.
     * The PA editor always sees the most recent work in progress.
     */
    protected async findPreferredRevision(
        itemId: string,
    ): Promise<ContentRevision | null> {
        for (const status of ['DRAFT', 'PUBLISHED', 'APPROVED'] as const) {
            const rev = await this.contentRevisionRepository.findOne({
                where: { itemId, status },
                order: ['revisionNo DESC'],
            });
            if (rev) return rev;
        }
        return null;
    }

    /**
     * Returns the existing DRAFT revision, or creates a new one forked from
     * the latest revision (copying all translation rows into the new draft).
     * Ensures the "max one DRAFT per item" invariant: if a DRAFT already exists,
     * it is returned as-is without creating a duplicate.
     */
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

        // Fork all translation rows from the latest revision into the new draft
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
                    // Source lang stays DRAFT; other langs keep their tStatus
                    // (may already be STALE from a previous approval cycle)
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
        allRevisions: ContentRevision[] = [],
    ): DocumentTypeFull {
        const translations: Record<
            string,
            { title: string; description: string; tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE' }
        > = {};

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
            revisions,
        });
    }
}