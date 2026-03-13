import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationJobInput, wfId, evKey } from './types';
import { TranslationSteps } from './translation.steps';
import { TranslationChildWorkflow } from './translation.child.workflow';

export class TranslationMasterWorkflow {

    @DBOS.workflow()
    static async run(input: TranslationJobInput): Promise<void> {

        // ── Step 1: push EN string to Gitea (idempotent, retried automatically) ──
        await TranslationSteps.pushSourceToGitea({
            category: input.category,
            itemId: input.itemId,
            fieldKey: input.fieldKey,
            value: input.sourceText,
        });

        // ── Step 2: launch one child WF per language ──
        // startWorkflow is idempotent: if a child was already started with that
        // workflowID (e.g. after a crash+restart), DBOS will not start it again.
        const handles = await Promise.all(
            input.targetLangs.map(lang =>
                DBOS.startWorkflow(TranslationChildWorkflow, {
                    workflowID: wfId.child(input.revisionId, lang),
                }).run({
                    revisionId: input.revisionId,
                    category: input.category,
                    fieldKey: input.fieldKey,
                    itemId: input.itemId,
                    lang,
                    sourceText: input.sourceText,
                }),
            ),
        );

        // ── Step 3: wait for ALL children to complete ──
        // getResult() blocks until the child WF resolves or rejects.
        // Because master itself is a durable workflow, this wait survives restarts.
        await Promise.allSettled(handles.map(h => h.getResult()));

        // ── Step 4: signal that the whole revision is done ──
        await DBOS.setEvent(evKey.masterDone(), true);
    }
}