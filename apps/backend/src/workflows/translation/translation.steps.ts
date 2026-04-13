/**
 * src/workflows/translation/translation.steps.ts
 *
 * DBOS @step functions for the translation + TTS workflow.
 *
 * Each step is:
 *   - Automatically retried by DBOS on transient failure
 *   - Idempotent (safe to re-run after a crash)
 *   - Side-effect free on repeated execution (Gitea PUT is idempotent by SHA)
 *
 * ── Logging note ──────────────────────────────────────────────────────────────
 *
 * DBOS.logger is a DLogger, NOT a Winston Logger.
 * Its signature is:  info(logEntry: unknown, metadata?: ContextualMetadata)
 * where ContextualMetadata = { includeContextMetadata?: boolean; span?: DBOSSpan }
 *
 * Structured data MUST be embedded in the first argument as a JSON string.
 * Passing a plain object as the second argument is a TS2353 type error:
 *   ✗  DBOS.logger.info('message', { revisionId })       // type error
 *   ✓  DBOS.logger.info(`message ${JSON.stringify({ revisionId })}`)
 *
 * ── Dependency injection strategy ────────────────────────────────────────────
 *
 * Steps are static methods — they run entirely outside the LoopBack DI container.
 * We use a module-level registry populated once at boot by
 * TranslationWorkflowOrchestratorService (which IS inside the DI container).
 *
 * Two registrations:
 *   1. RepositoryBundle             — content_revision_translation repository
 *   2. GiteaTranslationExportService singleton
 *
 * Call registerRepositoriesForSteps() and registerGiteaExportServiceForSteps()
 * in the orchestrator constructor to wire them up.
 *
 * ── AI translation mock ───────────────────────────────────────────────────────
 *
 * callAiTranslation() is intentionally a mock (returns empty strings).
 * Replace the body when a real AI service is available.
 *
 * ── TTS stub ─────────────────────────────────────────────────────────────────
 *
 * generateMp3() returns a placeholder URL.
 * Replace with ElevenLabs / Azure TTS when credentials are available.
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHash } from 'node:crypto';
import { GiteaTranslationExportService } from '../../services/gitea-translation-export.service';
import type { Logger } from 'winston';

// ── Repository access inside DBOS steps ──────────────────────────────────────

type RepositoryBundle = {
    getContentRevisionTranslationRepository: () => Promise<{
        findOne(filter: object): Promise<{ id?: string; tStatus?: string } | null>;
        create(data: object): Promise<object>;
        updateById(id: string, data: object): Promise<void>;
    }>;
};

let _repos: RepositoryBundle | null = null;

export function registerRepositoriesForSteps(repos: RepositoryBundle): void {
    _repos = repos;
    DBOS.logger.info('[TranslationSteps] Repository bundle registered');
}

function getRepos(): RepositoryBundle {
    if (!_repos) {
        throw new Error(
            '[TranslationSteps] Repository bundle not registered — call registerRepositoriesForSteps() at boot',
        );
    }
    return _repos;
}

// ── Service access inside DBOS steps ─────────────────────────────────────────

let _giteaExportService: GiteaTranslationExportService | null = null;

export function registerGiteaExportServiceForSteps(svc: GiteaTranslationExportService): void {
    _giteaExportService = svc;
    DBOS.logger.info('[TranslationSteps] GiteaTranslationExportService registered');
}

function getGiteaExportService(): GiteaTranslationExportService {
    if (!_giteaExportService) {
        // Fallback for DBOS crash-recovery: steps may run before the orchestrator
        // has initialised.  Create a one-off instance with the DBOS logger cast.
        DBOS.logger.warn(
            '[TranslationSteps] GiteaTranslationExportService not registered — ' +
            'creating fallback instance. ' +
            'Call registerGiteaExportServiceForSteps() in the orchestrator constructor.',
        );
        _giteaExportService = new GiteaTranslationExportService(
            DBOS.logger as unknown as Logger,
        );
    }
    return _giteaExportService;
}

// ─────────────────────────────────────────────────────────────────────────────

export class TranslationSteps {

    /**
     * Compute a stable SHA-256 hash of the source fields object.
     * Used as the idempotency key for Weblate webhook re-deliveries.
     * Called synchronously (no I/O) — not a DBOS step.
     */
    static computeSourceHash(fields: Record<string, string>): string {
        const stable = JSON.stringify(
            Object.keys(fields).sort().reduce((acc, k) => ({ ...acc, [k]: fields[k] }), {}),
        );
        return createHash('sha256').update(stable).digest('hex').slice(0, 32);
    }

    // ── Step: discover which languages still need translation ─────────────────

    /**
     * Returns the subset of targetLangs that have no existing non-STALE
     * translation row — i.e. langs where work is actually needed.
     *
     * Langs with DRAFT/APPROVED/PUBLISHED rows are skipped (user edited manually).
     * Langs with STALE rows need re-translation (source changed after last translation).
     */
    @DBOS.step()
    static async discoverLangsNeedingTranslation(input: {
        revisionId: string;
        targetLangs: string[];
    }): Promise<string[]> {
        DBOS.logger.info(
            `[TranslationSteps] discoverLangsNeedingTranslation start ${JSON.stringify({
                revisionId: input.revisionId,
                targetLangs: input.targetLangs,
            })}`,
        );

        const repos = getRepos();
        const translRepo = await repos.getContentRevisionTranslationRepository();
        const needs: string[] = [];
        const skipped: string[] = [];

        for (const lang of input.targetLangs) {
            const existing = await translRepo.findOne({
                where: { revisionId: input.revisionId, lang },
            });

            const tStatus = (existing as { tStatus?: string } | null)?.tStatus ?? null;
            const needsWork = !existing || tStatus === 'STALE';

            DBOS.logger.debug(
                `[TranslationSteps] lang check ${JSON.stringify({
                    revisionId: input.revisionId,
                    lang,
                    exists: !!existing,
                    tStatus,
                    needsWork,
                })}`,
            );

            if (needsWork) {
                needs.push(lang);
            } else {
                skipped.push(lang);
            }
        }

        DBOS.logger.info(
            `[TranslationSteps] discoverLangsNeedingTranslation done ${JSON.stringify({
                revisionId: input.revisionId,
                total: input.targetLangs.length,
                needed: needs.length,
                skipped: skipped.length,
                needsTranslation: needs,
                alreadyTranslated: skipped,
            })}`,
        );

        return needs;
    }

    // ── Step: AI pre-translation (mock — replace with real service) ───────────

    /**
     * MOCK — returns empty strings for all fields.
     *
     * Replace this body with a real AI translation call when ready:
     *   const result = await aiClient.translate({ sourceLang, targetLang, fields });
     *   return result.translations;
     *
     * Contract: returns a Record with the same keys as input.fields,
     * values are the AI-translated strings (or '' if AI could not translate).
     */
    @DBOS.step({ retriesAllowed: true, intervalSeconds: 10, maxAttempts: 3 })
    static async callAiTranslation(input: {
        sourceLang: string;
        targetLang: string;
        fields: Record<string, string>;
        revisionId: string;
    }): Promise<Record<string, string>> {
        DBOS.logger.info(
            `[TranslationSteps] callAiTranslation (MOCK) ${JSON.stringify({
                revisionId: input.revisionId,
                sourceLang: input.sourceLang,
                targetLang: input.targetLang,
                fieldCount: Object.keys(input.fields).length,
                fieldKeys: Object.keys(input.fields),
            })}`,
        );

        // MOCK: return empty strings — the Weblate translator will fill them in.
        return Object.fromEntries(
            Object.keys(input.fields).map(k => [k, '']),
        );
    }

    // ── Step: push all source fields to Gitea ─────────────────────────────────

    /**
     * Pushes each field of the source revision to the Gitea JSON catalog.
     * This makes the strings visible to Weblate for translation.
     *
     * ── File path convention ──────────────────────────────────────────────────
     *
     *   <category>/<isoCode>.json   (NO "backend/" prefix)
     *   e.g.  user-types/en.json
     *
     * ── Key format ────────────────────────────────────────────────────────────
     *
     *   `<itemId>:<fieldKey>`   e.g. `42:title`, `42:description`
     *
     * If aiTranslation is true, also pre-populates target lang files with
     * AI-generated suggestions (translator sees a starting point, not blank).
     */
    @DBOS.step()
    static async pushSourceFieldsToGitea(input: {
        category: string;
        itemId: string;
        revisionId: string;          // stored in Gitea meta for push-controller reconciliation
        sourceLang: string;
        fields: Record<string, string>;
        aiTranslation: boolean;
        aiResults?: Record<string, Record<string, string>>;  // lang → { field → translated }
    }): Promise<void> {
        const svc = getGiteaExportService();

        DBOS.logger.info(
            `[TranslationSteps] pushSourceFieldsToGitea start ${JSON.stringify({
                category: input.category,
                itemId: input.itemId,
                sourceLang: input.sourceLang,
                fieldKeys: Object.keys(input.fields),
                aiTranslation: input.aiTranslation,
                aiLangs: input.aiResults ? Object.keys(input.aiResults) : [],
            })}`,
        );

        let pushedSource = 0;
        let pushedAi = 0;
        let skippedEmpty = 0;

        for (const [fieldKey, value] of Object.entries(input.fields)) {
            if (!value.trim()) {
                DBOS.logger.debug(
                    `[TranslationSteps] skipping empty field ${JSON.stringify({
                        category: input.category,
                        itemId: input.itemId,
                        fieldKey,
                    })}`,
                );
                skippedEmpty++;
                continue;
            }

            // Push source language — include revisionId and sourceHash in meta so the push
            // controller can signal the DBOS child workflow directly from
            // the Gitea catalog, without needing the in-memory registry.
            const result = await svc.exportTranslationEntry({
                category: input.category,
                isoCode: input.sourceLang,
                itemId: input.itemId,
                fieldKey,
                value,
                meta: {
                    revisionId: input.revisionId,
                    // sourceHash stored here so push controller can build the
                    // DBOS idempotency key without re-computing from source fields
                    sourceHash: TranslationSteps.computeSourceHash(input.fields),
                },
            });

            DBOS.logger.debug(
                `[TranslationSteps] pushed source field ${JSON.stringify({
                    category: input.category,
                    itemId: input.itemId,
                    fieldKey,
                    sourceLang: input.sourceLang,
                    giteaPath: result.path,
                    giteaKey: result.key,
                    action: result.createdOrUpdated,
                })}`,
            );
            pushedSource++;

            // Push AI pre-translations if available
            if (input.aiTranslation && input.aiResults) {
                for (const [lang, translated] of Object.entries(input.aiResults)) {
                    const translatedValue = translated[fieldKey];
                    if (!translatedValue) continue;

                    const aiResult = await svc.exportTranslationEntry({
                        category: input.category,
                        isoCode: lang,
                        itemId: input.itemId,
                        fieldKey,
                        value: translatedValue,
                    });

                    DBOS.logger.debug(
                        `[TranslationSteps] pushed AI pre-translation ${JSON.stringify({
                            category: input.category,
                            itemId: input.itemId,
                            fieldKey,
                            lang,
                            giteaPath: aiResult.path,
                            action: aiResult.createdOrUpdated,
                        })}`,
                    );
                    pushedAi++;
                }
            }
        }

        DBOS.logger.info(
            `[TranslationSteps] pushSourceFieldsToGitea done ${JSON.stringify({
                category: input.category,
                itemId: input.itemId,
                sourceLang: input.sourceLang,
                pushedSource,
                pushedAi,
                skippedEmpty,
            })}`,
        );
    }

    // ── Step: save translation to DB ──────────────────────────────────────────

    /**
     * Upserts the content_revision_translation row for a completed translation.
     * Called by the child workflow after the Weblate webhook arrives.
     *
     * Sets tStatus = 'APPROVED' (human-validated by Weblate translator).
     * Sets sourceHash so we can detect future staleness.
     */
    @DBOS.step()
    static async saveTranslationToDB(input: {
        revisionId: string;
        lang: string;
        fields: Record<string, string>;  // translated fields from Weblate
        sourceHash: string;
        mp3Url: string | null;
    }): Promise<void> {
        DBOS.logger.info(
            `[TranslationSteps] saveTranslationToDB start ${JSON.stringify({
                revisionId: input.revisionId,
                lang: input.lang,
                fieldKeys: Object.keys(input.fields),
                sourceHash: input.sourceHash,
                mp3Url: input.mp3Url,
            })}`,
        );

        const repos = getRepos();
        const translRepo = await repos.getContentRevisionTranslationRepository();

        const existing = await translRepo.findOne({
            where: { revisionId: input.revisionId, lang: input.lang },
        });

        const existingId = (existing as { id?: string } | null)?.id ?? null;

        DBOS.logger.debug(
            `[TranslationSteps] saveTranslationToDB existing row ${JSON.stringify({
                revisionId: input.revisionId,
                lang: input.lang,
                existingId,
                existingTStatus: (existing as { tStatus?: string } | null)?.tStatus ?? null,
            })}`,
        );

        const data = {
            revisionId: input.revisionId,
            lang: input.lang,
            title: input.fields['title'] ?? '',
            description: input.fields['description'] ?? '',
            tStatus: 'APPROVED' as const,
            sourceHash: input.sourceHash,
            lastImportAt: new Date().toISOString(),
            ...(input.mp3Url ? { i18nExtra: { mp3Url: input.mp3Url } } : {}),
        };

        if (existingId) {
            await translRepo.updateById(existingId, data);
            DBOS.logger.info(
                `[TranslationSteps] saveTranslationToDB updated ${JSON.stringify({
                    revisionId: input.revisionId,
                    lang: input.lang,
                    id: existingId,
                })}`,
            );
        } else {
            await translRepo.create({ ...data, i18nExtra: data.i18nExtra ?? {} });
            DBOS.logger.info(
                `[TranslationSteps] saveTranslationToDB created ${JSON.stringify({
                    revisionId: input.revisionId,
                    lang: input.lang,
                })}`,
            );
        }
    }

    // ── Step: TTS generation ──────────────────────────────────────────────────

    /**
     * Generates an MP3 audio file for the given text and language.
     *
     * STUB — returns a placeholder URL.
     * Replace with: ElevenLabs, Azure Cognitive Services TTS, or similar.
     *
     * The `title` field is used as the primary TTS input.
     */
    @DBOS.step({ retriesAllowed: true, intervalSeconds: 30, maxAttempts: 5 })
    static async generateMp3(input: {
        lang: string;
        fields: Record<string, string>;
        revisionId: string;
    }): Promise<string | null> {
        const text = input.fields['title'] ?? '';

        if (!text.trim()) {
            DBOS.logger.debug(
                `[TranslationSteps] generateMp3 skipped — empty title ${JSON.stringify({
                    revisionId: input.revisionId,
                    lang: input.lang,
                })}`,
            );
            return null;
        }

        DBOS.logger.info(
            `[TranslationSteps] generateMp3 STUB ${JSON.stringify({
                revisionId: input.revisionId,
                lang: input.lang,
                textLength: text.length,
                textPreview: text.slice(0, 60),
            })}`,
        );

        // ── TODO: replace with real TTS call ───────────────────────────────────
        // Example (ElevenLabs):
        //   const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/{voice_id}', {
        //       method: 'POST',
        //       headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
        //       body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        //   });
        //   const mp3Buffer = await response.arrayBuffer();
        //   return storageService.uploadMp3(mp3Buffer, input.revisionId, input.lang);
        // ─────────────────────────────────────────────────────────────────────

        return `https://storage.placeholder/tts/${input.revisionId}/${input.lang}.mp3`;
    }
}