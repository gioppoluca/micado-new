import { injectable } from '@loopback/core';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationMasterWorkflow } from '../workflows/translation/translation.master.workflow';
import {
    TranslationJobInput, WeblateWebhookPayload,
    TranslationStatus, wfId, evKey, recvTopic, sendKey,
} from '../workflows/translation/types';

export type RevisionStatusView = {
    revisionId: string;
    done: boolean;
    languages: Record<string, {
        status: TranslationStatus | null;
        mp3Url: string | null;
    }>;
};

@injectable()
export class TranslationWorkflowOrchestratorService {

    /**
     * Start the master workflow for a revision.
     * Safe to call twice: DBOS ignores duplicate workflowIDs.
     */
    async startRevisionFlow(input: TranslationJobInput): Promise<{ workflowID: string }> {
        const workflowID = wfId.master(input.revisionId);
        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID })
            .run(input);
        return { workflowID };
    }

    /**
     * Called by the Weblate webhook controller.
     * Delivers the translated string to the correct child workflow.
     * The idempotency key deduplicates re-delivered webhooks.
     */
    async signalTranslationReceived(payload: WeblateWebhookPayload): Promise<void> {
        const childId = wfId.child(payload.revisionId, payload.lang);
        await DBOS.send(
            childId,
            payload,
            recvTopic(payload.lang),
            sendKey(payload.revisionId, payload.lang, payload.sourceHash),
        );
    }

    /**
     * Returns the current status of every language in a revision.
     * Controllers can poll this to show a dashboard.
     *
     * NOTE: getEvent() returns null if the child WF has not yet set that event,
     * which means either the WF hasn't started yet or it's still in an earlier step.
     */
    async getRevisionStatus(
        revisionId: string,
        targetLangs: string[],
    ): Promise<RevisionStatusView> {

        const statuses = await Promise.all(
            targetLangs.map(async lang => {
                const childId = wfId.child(revisionId, lang);
                const [status, mp3Url] = await Promise.all([
                    DBOS.getEvent<TranslationStatus>(childId, evKey.childStatus(lang)),
                    DBOS.getEvent<string | null>(childId, evKey.childMp3(lang)),
                ]);
                return { lang, status, mp3Url: mp3Url ?? null };
            }),
        );

        const masterDone = await DBOS.getEvent<boolean>(
            wfId.master(revisionId),
            evKey.masterDone(),
        );

        return {
            revisionId,
            done: masterDone === true,
            languages: Object.fromEntries(
                statuses.map(s => [s.lang, { status: s.status, mp3Url: s.mp3Url }]),
            ),
        };
    }
}