// src/controllers/translation-export-poc.controller.ts
import { inject } from '@loopback/core';
import { post, requestBody, response } from '@loopback/rest';
import { GiteaTranslationExportService } from '../services/gitea-translation-export.service';
import { TranslationExportRequest } from '../models/translation-export-request.model';

export class TranslationExportPocController {
    constructor(
        @inject('services.GiteaTranslationExportService')
        private giteaTranslationExportService: GiteaTranslationExportService,
    ) { }

    @post('/poc/translations/export')
    @response(200, {
        description: 'Export a translation entry to Gitea',
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['path', 'key', 'branch', 'createdOrUpdated'],
                    properties: {
                        path: { type: 'string' },
                        key: { type: 'string' },
                        branch: { type: 'string' },
                        createdOrUpdated: {
                            type: 'string',
                            enum: ['created', 'updated'],
                        },
                    },
                },
            },
        },
    })
    async export(
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: { 'x-ts-type': TranslationExportRequest },
                },
            },
        })
        body: TranslationExportRequest,
    ): Promise<{
        path: string;
        key: string;
        branch: string;
        createdOrUpdated: 'created' | 'updated';
    }> {
        return this.giteaTranslationExportService.exportTranslationEntry(body);
    }
}