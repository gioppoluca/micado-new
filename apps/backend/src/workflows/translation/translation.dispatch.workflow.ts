import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationJobInput, wfId } from './types';
import { TranslationSteps } from './translation.steps';
import { TranslationChildWorkflow } from './translation.child.workflow';

/** Supplemental workflow used when a language is enabled after approval. */
export class TranslationDispatchWorkflow {
    @DBOS.workflow()
    static async run(input: TranslationJobInput): Promise<string[]> {
        const { revisionId, category, itemId, sourceLang, fields, targetLangs, flags } = input;

        if (targetLangs.length === 0) return [];

        const aiResults: Record<string, Record<string, string>> = {};
        if (flags.aiTranslation) {
            for (const lang of targetLangs) {
                aiResults[lang] = await TranslationSteps.callAiTranslation({
                    sourceLang, targetLang: lang, fields, revisionId,
                });
            }
        }

        // Register the durable receivers before touching Gitea. This both avoids
        // losing a fast webhook and makes the operational state immediately SENT.
        await Promise.all(targetLangs.map(lang =>
            DBOS.startWorkflow(TranslationChildWorkflow, {
                workflowID: wfId.child(revisionId, lang),
            }).run({ revisionId, category, itemId, sourceLang, lang, fields, flags }),
        ));

        await TranslationSteps.pushSourceFieldsToGitea({
            category,
            itemId,
            revisionId,
            sourceLang,
            fields,
            aiTranslation: flags.aiTranslation,
            aiResults: flags.aiTranslation ? aiResults : undefined,
        });

        return targetLangs;
    }
}
