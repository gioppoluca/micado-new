import { injectable } from '@loopback/core';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationWorkflows } from '../workflows/translation/translation.workflows';

@injectable()
export class WorkflowOrchestratorService {
    buildParentId(revisionId: string) {
        return `tr:${revisionId}`;
    }

    buildChildId(revisionId: string, lang: string) {
        return `tr:${revisionId}:${lang}`;
    }

    async startTranslationFlow(revisionId: string, langs: string[]) {
        const workflowID = this.buildParentId(revisionId);
        // avvia il master: nel workflow creerà i figli
        const parentId = `tr:${revisionId}`;
        const handle = await DBOS.startWorkflow(TranslationWorkflows, { workflowID: parentId })
            .translationMaster(revisionId, langs);

        const result = await handle.getResult();
    }

    async signalLanguageImport(revisionId: string, lang: string, payload: unknown, sourceHash: string) {
        const childId = this.buildChildId(revisionId, lang);
        // topic per lingua; idempotencyKey per webhook duplicati
        return DBOS.send(
            childId,
            { payload, sourceHash },
            `weblate-import:${lang}`,
            `weblate:${revisionId}:${lang}:${sourceHash}`,
        );
    }
}