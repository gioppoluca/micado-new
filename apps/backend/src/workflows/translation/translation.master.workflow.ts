/**
 * src/workflows/translation/translation.master.workflow.ts
 *
 * Master workflow for a single content_revision approval.
 *
 * ── Full flow ────────────────────────────────────────────────────────────────
 *
 *  1. Discover which target languages still need translation
 *     (active langs minus source lang minus langs with valid existing translations)
 *
 *  2. [If ai_translation flag] Call AI pre-translation for each lang that needs it
 *     The AI results are pre-filled into Gitea so the human translator sees
 *     a suggestion rather than a blank field.
 *
 *  3. Push all source fields to Gitea (and AI pre-fills if available)
 *     Weblate detects the new/updated strings and creates translation tasks.
 *
 *  4. [If tts flag] Generate MP3 for the SOURCE language immediately.
 *     Target langs are TTS-ed inside their child workflows (after Weblate).
 *
 *  5. Launch one child workflow per target language.
 *     Each child waits durably for its Weblate webhook.
 *
 *  6. Wait for ALL children to complete (or timeout).
 *
 *  7. Signal master:done.
 *
 * ── Generic design ───────────────────────────────────────────────────────────
 *
 * This workflow is content-type agnostic. The caller (e.g. UserTypeFacadeService)
 * passes `category` and `itemId`. Future content types (NEWS, PROCESS, etc.)
 * reuse this same workflow — only those two parameters differ.
 *
 * ── Durability ───────────────────────────────────────────────────────────────
 *
 * The workflow is restarted automatically if the server crashes.
 * Each @step is idempotent; DBOS.startWorkflow() is idempotent by workflowID.
 * Feature flag values are captured in the input (not re-read on restart) so
 * behaviour is consistent even if flags change while the workflow is running.
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationJobInput, wfId, evKey } from './types';
import { TranslationSteps } from './translation.steps';
import { TranslationChildWorkflow } from './translation.child.workflow';

export class TranslationMasterWorkflow {

    @DBOS.workflow()
    static async run(input: TranslationJobInput): Promise<void> {
        const { revisionId, category, itemId, sourceLang, fields, targetLangs, flags } = input;

        DBOS.logger.info(`[TranslationMasterWorkflow] starting ${JSON.stringify({
            revisionId,
            category,
            itemId,
            sourceLang,
            targetLangs,
            flags,
        })}`);

        // ── Step 1: discover which langs actually need work ───────────────────
        // The facade passes all active target langs; here we filter to only those
        // that don't already have a valid (non-STALE) translation row.
        const langsToProcess = await TranslationSteps.discoverLangsNeedingTranslation({
            revisionId,
            targetLangs,
        });

        if (langsToProcess.length === 0) {
            DBOS.logger.info(`[TranslationMasterWorkflow] no langs need translation — done ${JSON.stringify({
                revisionId,
            })}`);
            await DBOS.setEvent(evKey.masterDone(), true);
            return;
        }

        // ── Step 2: AI pre-translation (optional) ────────────────────────────
        // For each lang that needs translation, call the AI mock.
        // Collect results so they can be pushed to Gitea alongside the source.
        const aiResults: Record<string, Record<string, string>> = {};

        if (flags.aiTranslation) {
            DBOS.logger.info(`[TranslationMasterWorkflow] AI pre-translation enabled ${JSON.stringify({
                revisionId, langCount: langsToProcess.length,
            })}`);

            for (const lang of langsToProcess) {
                const translated = await TranslationSteps.callAiTranslation({
                    sourceLang,
                    targetLang: lang,
                    fields,
                    revisionId,
                });
                aiResults[lang] = translated;
            }
        }

        // ── Step 3: push source (+ AI pre-fills) to Gitea ────────────────────
        await TranslationSteps.pushSourceFieldsToGitea({
            category,
            itemId,
            sourceLang,
            fields,
            aiTranslation: flags.aiTranslation,
            aiResults: flags.aiTranslation ? aiResults : undefined,
        });

        // ── Step 4: TTS for source language (fire-and-forget) ────────────────
        // The source language gets TTS immediately on APPROVED — it doesn't
        // wait for Weblate since the source text is already final.
        if (flags.tts) {
            try {
                const srcMp3 = await TranslationSteps.generateMp3({
                    lang: sourceLang,
                    fields,
                    revisionId,
                });
                if (srcMp3) {
                    // Persist the source MP3 URL into the source translation row
                    await TranslationSteps.saveTranslationToDB({
                        revisionId,
                        lang: sourceLang,
                        fields,
                        sourceHash: TranslationSteps.computeSourceHash(fields),
                        mp3Url: srcMp3,
                    });
                    DBOS.logger.info(`[TranslationMasterWorkflow] source TTS done ${JSON.stringify({
                        revisionId, lang: sourceLang, mp3Url: srcMp3,
                    })}`);
                }
            } catch (err) {
                // Source TTS failure is non-fatal — translations still proceed.
                DBOS.logger.warn(`[TranslationMasterWorkflow] source TTS failed (non-fatal) ${JSON.stringify({
                    revisionId, error: String(err),
                })}`);
            }
        }

        // ── Step 5: spawn one child workflow per target language ──────────────
        // startWorkflow is idempotent: if the server crashed after some children
        // were already started, DBOS will not start them again.
        const handles = await Promise.all(
            langsToProcess.map(lang =>
                DBOS.startWorkflow(TranslationChildWorkflow, {
                    workflowID: wfId.child(revisionId, lang),
                }).run({
                    revisionId,
                    category,
                    itemId,
                    sourceLang,
                    lang,
                    fields,
                    flags,
                }),
            ),
        );

        DBOS.logger.info(`[TranslationMasterWorkflow] children spawned ${JSON.stringify({
            revisionId,
            langs: langsToProcess,
        })}`);

        // ── Step 6: wait for ALL children ────────────────────────────────────
        // allSettled: a single child timeout/error does not abort the master.
        // Each child handles its own timeout internally (7 days).
        await Promise.allSettled(handles.map(h => h.getResult()));

        // ── Step 7: master done ───────────────────────────────────────────────
        await DBOS.setEvent(evKey.masterDone(), true);

        DBOS.logger.info(`[TranslationMasterWorkflow] all children settled — done ${JSON.stringify({
            revisionId,
            processed: langsToProcess.length,
        })}`);
    }
}