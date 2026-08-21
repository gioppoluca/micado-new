import { inject } from '@loopback/core';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { post, param, requestBody, HttpErrors } from '@loopback/rest';
import {
    DispatchMissingResult,
    TranslationWorkflowOrchestratorService,
} from '../services/translation-workflow-orchestrator.service';

export class TranslationDispatchController {
    constructor(
        @inject(TranslationWorkflowOrchestratorService.BINDING)
        private readonly orchestrator: TranslationWorkflowOrchestratorService,
    ) {}

    @post('/api/translations/revisions/{revisionId}/dispatch-missing', {
        responses: {
            '200': {
                description: 'Missing active languages dispatched idempotently',
                content: {'application/json': {schema: {type: 'object'}}},
            },
        },
    })
    @authenticate('keycloak')
    @authorize({allowedRoles: ['pa_admin', 'pa_operator']})
    async dispatchMissing(
        @param.path.string('revisionId') revisionId: string,
        @requestBody({
            required: false,
            content: {'application/json': {schema: {
                type: 'object',
                properties: {languages: {type: 'array', items: {type: 'string'}}},
            }}},
        }) body?: {languages?: string[]},
    ): Promise<DispatchMissingResult> {
        try {
            return await this.orchestrator.dispatchMissingTranslations(revisionId, body?.languages);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('only be dispatched')) throw new HttpErrors.Conflict(message);
            if (message.includes('missing') || message.includes('Unsupported')) {
                throw new HttpErrors.UnprocessableEntity(message);
            }
            throw error;
        }
    }
}
