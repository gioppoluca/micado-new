/**
 * src/services/user-type-facade.service.ts
 *
 * Facade bridging the generic Item/Revision/Translation core to the two
 * consumer-specific DTOs:
 *
 *   UserTypeLegacy  — flat, lightweight; used by list (GET /user-types) and
 *                     create (POST /user-types).  Contains only the sourceLang
 *                     translation so the list never pays a per-language query cost.
 *
 *   UserTypeFull    — rich; used by single-item GET (/user-types/:id) and the
 *                     PUT save (/user-types/:id).  Contains ALL per-language
 *                     translation rows embedded in `translations`.
 *
 * ── API surface ──────────────────────────────────────────────────────────────
 *
 *   GET  /user-types          → find()        → UserTypeLegacy[]  (list, lean)
 *   POST /user-types          → create()      → UserTypeLegacy    (returns flat)
 *   GET  /user-types/:id      → findById()    → UserTypeFull      (form open, rich)
 *   PUT  /user-types/:id      → replaceById() → 204               (form save, full)
 *   PATCH /user-types/:id     → updateById()  → 204               (status toggle / icon)
 *   DELETE /user-types/:id    → deleteById()  → 204
 *   GET  /user-types-migrant  → getTranslatedForFrontend()        (migrant, published only)
 *   GET  /user-types/to-production?id → publish()                 (workflow action)
 *
 * ── Actor stamp ──────────────────────────────────────────────────────────────
 *
 *   Every write method calls buildActorStamp(this.currentUser) and writes the
 *   result to the relevant JSONB audit column(s).  The stamp is an object:
 *     { sub, username, name, realm }
 *   stored natively as JSONB — no JSON.stringify/parse needed anywhere.
 *
 *   The facade is scoped TRANSIENT (not SINGLETON) so that LoopBack injects a
 *   fresh instance per HTTP request, giving each instance its own currentUser.
 *   SINGLETON would share one instance across all requests, breaking isolation.
 *
 * ── "Send to translation" toggle (DRAFT → APPROVED) ─────────────────────────
 *
 *   When replaceById() or updateById() receives status='APPROVED':
 *     - content_revision.status      → APPROVED
 *     - content_revision.approved_at → now()
 *     - content_revision.approved_by → actor stamp
 *     - Non-source translation rows  → tStatus='STALE'
 *
 * ── Role-based consumer map ──────────────────────────────────────────────────
 *
 *   PA admin  → GET /user-types       UserTypeLegacy[] (list)
 *             → GET /user-types/:id   UserTypeFull     (all tabs for editor)
 *   Migrant   → GET /user-types-migrant  flat, PUBLISHED, current lang only
 */

import { inject, injectable, BindingScope } from '@loopback/core';
import { Filter, repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionTranslation,
    UserTypeLegacy,
} from '../models';
import { UserTypeFull, RevisionSummary } from '../models/user-type-full.model';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
} from '../repositories';
import { buildActorStamp, ActorStamp } from '../auth/actor-stamp';
import { TranslationWorkflowOrchestratorService } from './translation-workflow-orchestrator.service';

const USER_TYPE_CODE = 'USER_TYPE';

/**
 * Fallback stamp used when publishing without a live HTTP request context
 * (e.g. background jobs, CLI scripts). Distinguishable from real users by sub='system'.
 */
const SYSTEM_STAMP: ActorStamp = {
    sub: 'system',
    username: 'system',
    name: 'System',
    realm: 'internal',
};

// TRANSIENT scope — a new instance per HTTP request so each instance gets its
// own currentUser from SecurityBindings. SINGLETON would share one instance
// across all requests and always hold the first user who triggered instantiation.
@injectable({ scope: BindingScope.TRANSIENT })
export class UserTypeFacadeService {
    constructor(
        @repository(ContentItemRepository)
        protected contentItemRepository: ContentItemRepository,

        @repository(ContentRevisionRepository)
        protected contentRevisionRepository: ContentRevisionRepository,

        @repository(ContentRevisionTranslationRepository)
        protected contentRevisionTranslationRepository: ContentRevisionTranslationRepository,

        // The authenticated user from the current HTTP request.
        // optional: true — the facade still works in background contexts
        // (boot observers, migration scripts) where no JWT is present.
        @inject(SecurityBindings.USER, { optional: true })
        protected currentUser: UserProfile | undefined,

        // Translation workflow orchestrator — optional so the facade works in
        // test environments where DBOS is not running.
        @inject(TranslationWorkflowOrchestratorService.BINDING, { optional: true })
        protected translationOrchestrator: TranslationWorkflowOrchestratorService | undefined,
    ) { }

    // ── List (lean) ───────────────────────────────────────────────────────────

    async find(_filter?: Filter<UserTypeLegacy>): Promise<UserTypeLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: USER_TYPE_CODE },
            order: ['externalKey ASC'],
        });

        const result: UserTypeLegacy[] = [];

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
        const mappedWhere: Record<string, unknown> = { typeCode: USER_TYPE_CODE };
        if (where?.id != null) mappedWhere.externalKey = String(where.id);
        const result = await this.contentItemRepository.count(mappedWhere);
        return { count: result.count };
    }

    // ── Single item (rich — form open) ────────────────────────────────────────

    /**
     * Returns UserTypeFull with ALL per-language translations embedded.
     * One query set — no second round-trip needed by the PA form.
     */
    async findById(id: number): Promise<UserTypeFull> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);

        if (!revision) {
            throw new HttpErrors.NotFound(`No revision found for USER_TYPE ${id}`);
        }

        const [translationRows, allRevisions] = await Promise.all([
            this.contentRevisionTranslationRepository.find({
                where: { revisionId: revision.id! },
            }),
            // Load all revisions for the version history panel.
            // Sorted ascending so the UI shows v1, v2, v3… in chronological order.
            // Only fields needed for the summary — no translation content.
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
     * Creates item + revision + translations in one transaction-like sequence.
     *
     * Accepts an optional `translations` map so the form can send all language
     * content in the initial POST — one round-trip for new records.
     *
     * Actor stamp written to:
     *   content_item.created_by      ← stamp
     *   content_item.updated_by      ← stamp (same at creation time)
     *   content_revision.created_by  ← stamp
     */
    async create(input: Omit<UserTypeLegacy, 'id' | 'status'> & {
        translations?: Record<string, { title: string; description?: string }>;
    }): Promise<UserTypeLegacy> {
        const stamp = buildActorStamp(this.currentUser);
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'en';

        const item = await this.contentItemRepository.create({
            typeCode: USER_TYPE_CODE,
            externalKey,
            // Conditional spread — exactOptionalPropertyTypes forbids explicit undefined.
            ...(stamp && { createdBy: stamp, updatedBy: stamp }),
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: input.dataExtra ?? {},
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
            // Fallback: single sourceLang row from flat fields
            await this.contentRevisionTranslationRepository.create({
                revisionId: revision.id!,
                lang: sourceLang,
                title: input.user_type ?? '',
                description: input.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }

        const sourceTr = hasMap
            ? translationMap[sourceLang]
            : { title: input.user_type ?? '', description: input.description ?? '' };

        return this.toLegacyDto(item, revision, {
            lang: sourceLang,
            title: sourceTr?.title ?? '',
            description: sourceTr?.description ?? '',
        });
    }

    // ── Full replace (form save) ──────────────────────────────────────────────

    /**
     * Replaces the full user type — metadata + all translations — in one call.
     * Used by PUT /user-types/:id (the PA form Save button).
     *
     * Languages absent from body.translations are NOT deleted — only upserted.
     * A translator working on language X should not lose work if the PA editor
     * saves without that tab open.
     *
     * Actor stamp written to:
     *   content_item.updated_by      ← stamp (every save)
     *   content_revision.approved_by ← stamp (only on DRAFT → APPROVED transition)
     *   content_revision.approved_at ← now() (same condition)
     */
    async replaceById(id: number, body: UserTypeFull): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        const sourceLang = body.sourceLang ?? draft.sourceLang;

        // Always update item audit trail on any save
        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: body.dataExtra ?? {},
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

        // Handle DRAFT → APPROVED transition ("Send to translation" toggle)
        if (body.status === 'APPROVED' && draft.status !== 'APPROVED') {
            await this.contentRevisionRepository.updateById(draft.id!, {
                status: 'APPROVED',
                approvedAt: new Date().toISOString(),
                ...(stamp && { approvedBy: stamp }),
            });
            await this.markNonSourceTranslationsStale(draft.id!, sourceLang);

            // Start the translation + TTS workflow for this revision.
            // The source translation row must exist (created by the form) so
            // we can extract the canonical title + description for the workflow.
            await this.startTranslationWorkflow(item, draft, sourceLang);
        }
    }

    // ── Partial update (status toggle, icon-only) ─────────────────────────────

    /**
     * Partial update — handles the list-row status toggle and single-field
     * changes (e.g. icon update without re-sending all translations).
     *
     * Actor stamp written to:
     *   content_item.updated_by      ← stamp (always)
     *   content_revision.approved_by ← stamp (only on DRAFT → APPROVED)
     *   content_revision.approved_at ← now() (same condition)
     */
    async updateById(id: number, patch: Partial<UserTypeLegacy>): Promise<void> {
        const stamp = buildActorStamp(this.currentUser);
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        // Always update item audit trail
        await this.contentItemRepository.updateById(item.id!, {
            ...(stamp && { updatedBy: stamp }),
        });

        if (patch.dataExtra !== undefined) {
            await this.contentRevisionRepository.updateById(draft.id!, {
                dataExtra: { ...(draft.dataExtra ?? {}), ...patch.dataExtra },
            });
        }

        if (patch.user_type !== undefined || patch.description !== undefined) {
            const lang = patch.sourceLang ?? draft.sourceLang;
            const existing = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: draft.id!, lang },
            });

            if (existing) {
                await this.contentRevisionTranslationRepository.updateById(existing.id!, {
                    title: patch.user_type !== undefined ? patch.user_type : existing.title,
                    description: patch.description !== undefined ? patch.description : existing.description,
                });
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!,
                    lang,
                    title: patch.user_type ?? '',
                    description: patch.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }

        // Handle status transition
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

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        await this.contentItemRepository.deleteById(item.id!);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    async getTranslatedForFrontend(
        defaultLang = 'en',
        currentLang = 'en',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: USER_TYPE_CODE, publishedRevisionId: { neq: null as unknown as string } },
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
                user_type: tr.title,
                description: tr.description,
                lang: tr.lang,
            });
        }

        return result;
    }

    // ── Publish ───────────────────────────────────────────────────────────────

    /**
     * Promotes the APPROVED revision to PUBLISHED and sets it as live.
     *
     * Actor stamp written to:
     *   content_revision.published_by ← stamp (or SYSTEM_STAMP for background jobs)
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
                `No APPROVED revision available for USER_TYPE ${id}`,
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

        // Archive the previously PUBLISHED revision (if any) so there is only
        // ever one PUBLISHED revision per item at any time.
        // We query by item_id + status=PUBLISHED excluding the one we just promoted.
        const previouslyPublished = await this.contentRevisionRepository.find({
            where: {
                itemId: item.id!,
                status: 'PUBLISHED',
                id: { neq: approved.id! },
            },
        });
        for (const old of previouslyPublished) {
            await this.contentRevisionRepository.updateById(old.id!, { status: 'ARCHIVED' });
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
     * Starts the DBOS translation + TTS workflow for a newly approved revision.
     *
     * Reads the source translation row to extract title + description.
     * If no source row exists (edge case: form saved without content), skips.
     * If the orchestrator is not injected (test env / DBOS not running), logs a warning.
     *
     * This method is called from both replaceById() and updateById() whenever
     * the status transitions to APPROVED — the single place the workflow is triggered.
     *
     * Generic: the category 'user-types' is the only USER_TYPE-specific value here.
     * Future content types (NEWS, PROCESS) will call the same orchestrator with
     * their own category string.
     */
    protected async startTranslationWorkflow(
        item: ContentItem,
        revision: ContentRevision,
        sourceLang: string,
    ): Promise<void> {
        if (!this.translationOrchestrator) {
            // DBOS not running in this environment (tests, dev without DBOS).
            // Log a warning but do not fail the request.
            return;
        }

        try {
            // Load the source translation row to get the current title + description
            const sourceTr = await this.contentRevisionTranslationRepository.findOne({
                where: { revisionId: revision.id!, lang: sourceLang },
            });

            if (!sourceTr) {
                // No source translation yet — nothing to send to Weblate.
                return;
            }

            const fields: Record<string, string> = {};
            if (sourceTr.title?.trim()) fields['title'] = sourceTr.title;
            if (sourceTr.description?.trim()) fields['description'] = sourceTr.description;

            if (Object.keys(fields).length === 0) {
                return;
            }

            await this.translationOrchestrator.startRevisionFlow({
                revision,
                item,
                category: 'user-types',   // USER_TYPE-specific; other facades use their own
                fields,
            });
        } catch (err) {
            // Workflow start failure must NOT fail the approval request itself.
            // The PA admin sees the content as APPROVED; the workflow can be
            // retried manually via the dev controller if needed.
            // We log here even though the facade has no injected logger —
            // console.error is acceptable for the single error path that never
            // reaches production code; replace with this.logger when added.
            console.error('[UserTypeFacadeService] startTranslationWorkflow failed', err);
        }
    }

    /**
     * When a revision moves to APPROVED, all non-source translation rows that
     * are still DRAFT are set to STALE.  This signals to translators (and
     * the Weblate workflow) that the source text has been frozen and their
     * work needs review.  STALE rows that were already APPROVED/PUBLISHED are
     * left untouched — they were already validated.
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

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: USER_TYPE_CODE },
            fields: { externalKey: true },
        });
        return items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0) + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: { typeCode: USER_TYPE_CODE, externalKey: String(id) },
        });
        if (!item) throw new HttpErrors.NotFound(`USER_TYPE ${id} not found`);
        return item;
    }

    protected async findPreferredRevision(
        itemId: string,
    ): Promise<ContentRevision | null> {
        // Editor always sees the most recent work: DRAFT > PUBLISHED > APPROVED
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
     * Used whenever an edit is triggered on a non-DRAFT item.
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
            sourceLang: latest?.sourceLang ?? 'en',
            dataExtra: latest?.dataExtra ?? {},
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
                    // Source lang stays DRAFT; other langs keep their current tStatus
                    // (they may already be STALE from a previous approval cycle)
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
    ): UserTypeLegacy {
        return Object.assign(new UserTypeLegacy(), {
            id: Number(item.externalKey),
            user_type: translation?.title ?? '',
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
    ): UserTypeFull {
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

        // Build lightweight revision summaries for the version history panel.
        // createdBy is a JSONB object — unpack .name so the frontend gets a plain string.
        const revisions: RevisionSummary[] = allRevisions.map(r =>
            Object.assign(new RevisionSummary(), {
                revisionNo: r.revisionNo,
                status: r.status,
                createdAt: r.createdAt,
                createdByName: (r.createdBy as { name?: string } | undefined)?.name ?? 'System',
                publishedAt: r.publishedAt,
            }),
        );

        return Object.assign(new UserTypeFull(), {
            id: Number(item.externalKey),
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
            translations,
            revisions,
        });
    }
}