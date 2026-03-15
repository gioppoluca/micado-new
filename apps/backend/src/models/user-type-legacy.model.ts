import { model, property } from '@loopback/repository';

@model({
    description: 'Legacy-compatible User Type DTO mapped to the generic content core',
})
export class UserTypeLegacy {
    @property({
        type: 'number',
        required: true,
    })
    id: number;

    @property({
        type: 'string',
    })
    user_type?: string;

    @property({
        type: 'string',
    })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: {
            enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
        },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({
        type: 'string',
    })
    sourceLang?: string;

    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: true,
        },
    })
    dataExtra?: Record<string, unknown>;
}