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
 * Steps that call external services (Gitea, AI, TTS) are deliberately kept
 * thin — all logic lives in injectable services so it can be tested without DBOS.
 *
 * ── AI translation mock ──────────────────────────────────────────────────────
 *
 * `callAiTranslation()` is intentionally a mock (returns empty strings).
 * Replace the body when the actual AI service (e.g. DeepL, Azure Translator,
 * or a custom LLM endpoint) is available.  The contract is:
 *   input:  source fields + target lang
 *   output: translated fields (same keys, translated values)
 *
 * ── TTS stub ─────────────────────────────────────────────────────────────────
 *
 * `generateMp3()` returns a placeholder URL.  Replace with ElevenLabs / Azure TTS
 * when the service credentials are available.
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHash } from 'node:crypto';
import { GiteaTranslationExportService } from '../../services/gitea-translation-export.service';
// TranslationJobInput and ChildWorkflowInput are used by callers — no local use here

// ── Repository access inside DBOS steps ──────────────────────────────────────
// Steps run outside the LoopBack DI container, so we use a module-level
// repository getter that is set once at boot (see translation.workflows.ts).
// This avoids requiring injection inside a static class.

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
}

function getRepos(): RepositoryBundle {
    if (!_repos) throw new Error('[TranslationSteps] repositories not registered — call registerRepositoriesForSteps() at boot');
    return _repos;
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
     * Langs with DRAFT/APPROVED/PUBLISHED rows are skipped (user edited manually).
     */
    @DBOS.step()
    static async discoverLangsNeedingTranslation(input: {
        revisionId: string;
        targetLangs: string[];
    }): Promise<string[]> {
        const repos = getRepos();
        const translRepo = await repos.getContentRevisionTranslationRepository();
        const needs: string[] = [];

        for (const lang of input.targetLangs) {
            // A single query tells us everything:
            // - No row → translation never done → needs work
            // - Row with tStatus STALE → source changed after last translation → needs work
            // - Row with tStatus DRAFT/APPROVED/PUBLISHED → valid, skip
            const existing = await translRepo.findOne({
                where: { revisionId: input.revisionId, lang },
            });

            const needsWork = !existing || (existing as { tStatus?: string }).tStatus === 'STALE';
            if (needsWork) {
                needs.push(lang);
            }
        }

        DBOS.logger.info(`[TranslationSteps] langs needing translation ${JSON.stringify({
            revisionId: input.revisionId,
            total: input.targetLangs.length,
            needed: needs.length,
            skipped: input.targetLangs.length - needs.length,
        })}`);

        return needs;
    }

    // ── Step: AI pre-translation (mock — replace with real service) ───────────

    /**
     * MOCK — returns empty strings for all fields.
     *
     * Replace this body with a real AI translation call when ready:
     *   const result = await aiTranslationClient.translate({
     *       sourceLang: input.sourceLang,
     *       targetLang: input.targetLang,
     *       fields:     input.fields,
     *   });
     *   return result.translations;
     *
     * Contract: returns a Record with the same keys as input.fields,
     * values are the AI-translated strings (or '' if AI could not translate).
     */
    @DBOS.step({ intervalSeconds: 10, maxAttempts: 3 })
    static async callAiTranslation(input: {
        sourceLang: string;
        targetLang: string;
        fields: Record<string, string>;
        revisionId: string;
    }): Promise<Record<string, string>> {
        DBOS.logger.info(`[TranslationSteps] AI translation mock called ${JSON.stringify({
            revisionId: input.revisionId,
            sourceLang: input.sourceLang,
            targetLang: input.targetLang,
            fieldCount: Object.keys(input.fields).length,
        })}`);

        // MOCK: return empty strings — the Weblate translator will fill them in.
        // When a real AI service is wired up, return the AI translations here.
        // Weblate will show them as pre-filled suggestions.
        return Object.fromEntries(
            Object.keys(input.fields).map(k => [k, '']),
        );
    }

    // ── Step: push all source fields to Gitea ────────────────────────────────

    /**
     * Pushes each field of the source revision to the Gitea JSON catalog.
     * This makes the strings visible to Weblate for translation.
     *
     * Key format in Gitea JSON: `{itemId}:{fieldKey}`
     * e.g. `42:title`, `42:description`
     *
     * If aiTranslation is true, also pre-populates the target lang files with
     * AI-generated suggestions (the translator sees a starting point, not blank).
     */
    @DBOS.step()
    static async pushSourceFieldsToGitea(input: {
        category: string;
        itemId: string;
        sourceLang: string;
        fields: Record<string, string>;
        aiTranslation: boolean;
        aiResults?: Record<string, Record<string, string>>;  // lang → { field → translated }
    }): Promise<void> {
        const svc = new GiteaTranslationExportService(DBOS.logger as unknown as import('winston').Logger);

        for (const [fieldKey, value] of Object.entries(input.fields)) {
            if (!value.trim()) continue;  // skip empty fields

            // Push source language
            await svc.exportTranslationEntry({
                category: input.category,
                isoCode: input.sourceLang,
                itemId: input.itemId,
                fieldKey,
                value,
            });

            DBOS.logger.debug(`[TranslationSteps] pushed source field ${JSON.stringify({
                category: input.category,
                itemId: input.itemId,
                fieldKey,
                sourceLang: input.sourceLang,
            })}`);

            // Push AI pre-translations if available
            if (input.aiTranslation && input.aiResults) {
                for (const [lang, translated] of Object.entries(input.aiResults)) {
                    const translatedValue = translated[fieldKey];
                    if (!translatedValue) continue;
                    await svc.exportTranslationEntry({
                        category: input.category,
                        isoCode: lang,
                        itemId: input.itemId,
                        fieldKey,
                        value: translatedValue,
                    });
                }
            }
        }

        DBOS.logger.info(`[TranslationSteps] pushed all source fields to Gitea ${JSON.stringify({
            category: input.category,
            itemId: input.itemId,
            sourceLang: input.sourceLang,
            fields: Object.keys(input.fields),
        })}`);
    }

    // ── Step: save translation to DB ─────────────────────────────────────────

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
        const repos = getRepos();
        const translRepo = await repos.getContentRevisionTranslationRepository();

        const existing = await translRepo.findOne({
            where: { revisionId: input.revisionId, lang: input.lang },
        });

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

        if (existing?.id) {
            await translRepo.updateById(existing.id, data);
            DBOS.logger.info(`[TranslationSteps] updated translation row ${JSON.stringify({
                revisionId: input.revisionId, lang: input.lang,
            })}`);
        } else {
            await translRepo.create({ ...data, i18nExtra: data.i18nExtra ?? {} });
            DBOS.logger.info(`[TranslationSteps] created translation row ${JSON.stringify({
                revisionId: input.revisionId, lang: input.lang,
            })}`);
        }
    }

    // ── Step: TTS generation ─────────────────────────────────────────────────

    /**
     * Generates an MP3 audio file for the given text and language.
     *
     * STUB — returns a placeholder URL.
     * Replace with: ElevenLabs, Azure Cognitive Services TTS, or similar.
     *
     * The `title` field is used as the primary TTS input.
     * A full description TTS may be added later via a separate step.
     */
    @DBOS.step({ intervalSeconds: 30, maxAttempts: 5 })
    static async generateMp3(input: {
        lang: string;
        fields: Record<string, string>;
        revisionId: string;
    }): Promise<string | null> {
        const text = input.fields['title'] ?? '';
        if (!text.trim()) {
            DBOS.logger.debug(`[TranslationSteps] generateMp3 skipped — empty title ${JSON.stringify({
                revisionId: input.revisionId, lang: input.lang,
            })}`);
            return null;
        }

        DBOS.logger.info(`[TranslationSteps] generateMp3 stub called ${JSON.stringify({
            revisionId: input.revisionId,
            lang: input.lang,
            textLength: text.length,
        })}`);

        // ── TODO: replace with real TTS call ──────────────────────────────────
        // Example (ElevenLabs):
        //   const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/{voice_id}', {
        //       method: 'POST',
        //       headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
        //       body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        //   });
        //   const mp3Buffer = await response.arrayBuffer();
        //   const url = await storageService.uploadMp3(mp3Buffer, input.revisionId, input.lang);
        //   return url;
        // ─────────────────────────────────────────────────────────────────────

        return `https://storage.placeholder/tts/${input.revisionId}/${input.lang}.mp3`;
    }


}