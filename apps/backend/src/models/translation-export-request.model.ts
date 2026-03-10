// src/models/translation-export-request.model.ts
import { model, property } from '@loopback/repository';

@model()
export class TranslationExportRequest {
    @property({ type: 'string', required: true })
    category: string;

    @property({ type: 'string', required: true })
    isoCode: string;

    @property({ type: 'string', required: true })
    itemId: string;

    @property({ type: 'string', required: true })
    fieldKey: string;

    @property({ type: 'string', required: true })
    value: string;

    @property({ type: 'string' })
    comment?: string;

    @property({ type: 'string' })
    flags?: string;

    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: true,
        },
    })
    meta?: Record<string, unknown>;
}