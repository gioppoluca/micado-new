/**
 * src/workflows/translation/translation.child.workflow.ts
 *
 * One child workflow per (revision, target language).
 *
 * Lifecycle:
 *   1. Set status WAITING_TRANSLATION
 *   2. Wait durably for the Weblate webhook (up to 7 days)
 *   3. [If tts flag] Generate MP3
 *   4. Save translation + MP3 URL to content_revision_translation
 *   5. Set status DONE
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { ChildWorkflowInput, WeblateWebhookPayload, TranslationStatus, evKey, recvTopic } from './types';
import { TranslationSteps } from './translation.steps';

// Human translation can take days — set generously; DBOS checkpoints the wait.
const WEBLATE_TIMEOUT_SECONDS = 7 * 24 * 3600;

export class TranslationChildWorkflow {

    @DBOS.workflow()
    static async run(input: ChildWorkflowInput): Promise<void> {
        const { revisionId, lang, fields, flags } = input;

        await setStatus(lang, 'WAITING_TRANSLATION');

        // ── Wait for Weblate webhook (durable across restarts) ────────────────
        const msg = await DBOS.recv<WeblateWebhookPayload>(
            recvTopic(lang),
            WEBLATE_TIMEOUT_SECONDS,
        );

        if (!msg) {
            await setStatus(lang, 'TIMEOUT');
            DBOS.logger.warn(`[TranslationChildWorkflow] timeout waiting for Weblate ${JSON.stringify({
                revisionId, lang,
            })}`);
            return;
        }

        await setStatus(lang, 'RECEIVED_TRANSLATION');

        DBOS.logger.info(`[TranslationChildWorkflow] received translation ${JSON.stringify({
            revisionId,
            lang,
            fieldCount: Object.keys(msg.fields).length,
        })}`);

        // ── [Optional] Generate MP3 ───────────────────────────────────────────
        let mp3Url: string | null = null;
        if (flags.tts) {
            await setStatus(lang, 'GENERATING_MP3');
            try {
                mp3Url = await TranslationSteps.generateMp3({
                    lang,
                    fields: msg.fields,
                    revisionId,
                });
                await DBOS.setEvent(evKey.childMp3(lang), mp3Url);
                DBOS.logger.info(`[TranslationChildWorkflow] MP3 generated ${JSON.stringify({
                    revisionId, lang, mp3Url,
                })}`);
            } catch (err) {
                // MP3 failure is non-fatal — translation is still saved.
                // TranslationSteps.generateMp3 already retried maxAttempts times.
                DBOS.logger.warn(`[TranslationChildWorkflow] MP3 generation failed (non-fatal) ${JSON.stringify({
                    revisionId, lang, error: String(err),
                })}`);
                await DBOS.setEvent(evKey.childMp3(lang), null);
            }
        } else {
            await DBOS.setEvent(evKey.childMp3(lang), null);
        }

        // ── Save to DB ────────────────────────────────────────────────────────
        await setStatus(lang, 'SAVING_TO_DB');
        await TranslationSteps.saveTranslationToDB({
            revisionId,
            lang,
            fields: msg.fields,
            sourceHash: msg.sourceHash,
            mp3Url,
        });

        await setStatus(lang, 'DONE');
        DBOS.logger.info(`[TranslationChildWorkflow] done ${JSON.stringify({ revisionId, lang })}`);
    }
}

async function setStatus(lang: string, status: TranslationStatus): Promise<void> {
    await DBOS.setEvent(evKey.childStatus(lang), status);
}