import { DBOS } from '@dbos-inc/dbos-sdk';
import {
    ChildWorkflowInput, WeblateWebhookPayload,
    TranslationStatus, evKey, recvTopic,
} from './types';
import { TranslationSteps } from './translation.steps';

// How long (seconds) to wait for Weblate before giving up.
// Human translation can take days — set this generously.
const WEBLATE_TIMEOUT_SECONDS = 7 * 24 * 3600; // 7 days

export class TranslationChildWorkflow {

    @DBOS.workflow()
    static async run(input: ChildWorkflowInput): Promise<void> {
        const { revisionId, lang } = input;

        // ── State: waiting ──
        await setStatus(lang, 'WAITING_TRANSLATION');

        // ── Wait for Weblate webhook (durable: survives restarts) ──
        const msg = await DBOS.recv<WeblateWebhookPayload>(
            recvTopic(lang),
            WEBLATE_TIMEOUT_SECONDS,
        );

        if (!msg) {
            await setStatus(lang, 'TIMEOUT');
            // Optionally: emit an alert, or re-queue for manual retry.
            return;
        }

        // ── State: received ──
        await setStatus(lang, 'RECEIVED_TRANSLATION');

        // ── Generate MP3 ──
        await setStatus(lang, 'GENERATING_MP3');
        let mp3Url: string | null = null;
        try {
            mp3Url = await TranslationSteps.generateMp3({
                lang,
                translation: msg.translation,
                revisionId,
            });
            await DBOS.setEvent(evKey.childMp3(lang), mp3Url);
        } catch (err) {
            // MP3 failure is non-fatal: log it and continue saving the translation.
            // The step already retried maxAttempts times before throwing here.
            await DBOS.setEvent(evKey.childMp3(lang), null);
        }

        // ── Save to DB ──
        await setStatus(lang, 'SAVING_TO_DB');
        await TranslationSteps.saveTranslationToDB({
            revisionId,
            lang,
            itemId: input.itemId,
            fieldKey: input.fieldKey,
            translation: msg.translation,
            mp3Url,
            sourceHash: msg.sourceHash,
        });

        // ── Done ──
        await setStatus(lang, 'DONE');
    }
}

// Helper: avoids repeating the event key pattern everywhere
async function setStatus(lang: string, status: TranslationStatus) {
    await DBOS.setEvent(evKey.childStatus(lang), status);
}