import { post, requestBody } from '@loopback/rest';
import { inject } from '@loopback/core';
import { TranslationWorkflowOrchestratorService } from '../../services/translation-workflow-orchestrator.service';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationWorkflows } from '../../workflows/translation/translation.workflows';
export class TranslationWorkflowTestController {
    constructor(
        @inject('services.TranslationWorkflowOrchestratorService')
        private orch: TranslationWorkflowOrchestratorService,
    ) { }

    @post('/dev/workflows/translation/start')
    async start(@requestBody() body: { revisionId: string; langs: string[] }) {
        //const { workflowID, handle } = await this.orch.startRevisionFlow(body.revisionId, body.langs);
        //return { workflowID, handleId: handle.getWorkflowID?.() ?? workflowID };
        const workflowID = `tr:${body.revisionId}`;
        await DBOS.startWorkflow(TranslationWorkflows, { workflowID })
            .translationMaster(body.revisionId, body.langs);

        return { workflowID };
    }

    @post('/dev/workflows/translation/signal-import')
    async signal(@requestBody() body: { revisionId: string; lang: string; sourceHash: string; payload: unknown }) {
        await this.orch.signalTranslationReceived({
            revisionId: body.revisionId,
            lang: body.lang,
            sourceHash: body.sourceHash,
            translation: body.payload as string,  // WeblateWebhookPayload expects 'translation', not 'payload'
        });
        return { ok: true };
    }
}