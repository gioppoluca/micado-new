/**
 * src/controllers/migrant-documents.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /documents-migrant         List caller's documents (summaries, no binary)
 *   POST /documents-migrant         Upload a new document
 *   GET  /documents-migrant/:id     Fetch single document with full binary (base64)
 *   PUT  /documents-migrant/:id     Replace metadata and/or binary
 *   DEL  /documents-migrant/:id     Delete document
 *
 * ── Authorization ─────────────────────────────────────────────────────────────
 *
 *   All endpoints: authenticated migrant (migrants realm).
 *   Role: migrant_user (or any authenticated principal from the migrants realm).
 *   The service enforces that each migrant can only access their own documents
 *   by comparing the JWT sub with document.migrantId.
 *
 * ── Feature flag ─────────────────────────────────────────────────────────────
 *
 *   These endpoints are only meaningful when FEAT_DOCUMENTS is enabled.
 *   The PA activates the flag; the frontend hides the UI when it is off.
 *   The backend does NOT enforce the flag — it remains accessible so that
 *   documents uploaded before a flag change are still retrievable.
 *
 * ── Binary transfer ───────────────────────────────────────────────────────────
 *
 *   File content is transferred as base64 inside a JSON body.
 *   Maximum size is enforced by the service (default 10 MB, env DOCUMENT_MAX_BYTES).
 */

import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { del, get, param, post, put, requestBody } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import {
    MigrantDocumentService,
    type MigrantDocumentDto,
    type MigrantDocumentSummaryDto,
    type CreateMigrantDocumentInput,
    type UpdateMigrantDocumentInput,
} from '../services/migrant-document.service';

// ── Shared response schemas ──────────────────────────────────────────────────

const SUMMARY_SCHEMA = {
    type: 'object' as const,
    properties: {
        id:             { type: 'string' },
        migrantId:      { type: 'string' },
        documentTypeId: { type: 'number' },
        fileName:       { type: 'string' },
        mimeType:       { type: 'string' },
        shareable:      { type: 'boolean' },
        createdAt:      { type: 'string' },
        updatedAt:      { type: 'string' },
    },
};

const FULL_SCHEMA = {
    ...SUMMARY_SCHEMA,
    properties: {
        ...SUMMARY_SCHEMA.properties,
        fileData: { type: 'string', description: 'Base64-encoded file content.' },
    },
};

@authenticate('keycloak')
export class MigrantDocumentsController {
    constructor(
        @inject('services.MigrantDocumentService')
        private readonly documentService: MigrantDocumentService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/documents-migrant', {
        responses: {
            '200': {
                description: 'Documents owned by the authenticated migrant (no binary).',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: SUMMARY_SCHEMA },
                    },
                },
            },
        },
    })
    async list(
        @inject(SecurityBindings.USER) caller: UserProfile,
    ): Promise<MigrantDocumentSummaryDto[]> {
        const sub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        this.logger.info('[MigrantDocumentsController] list', { sub });
        return this.documentService.list(sub);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    @post('/documents-migrant', {
        responses: {
            '200': {
                description: 'Uploaded document with full binary.',
                content: { 'application/json': { schema: FULL_SCHEMA } },
            },
        },
    })
    async create(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['fileName', 'mimeType', 'fileData'],
                        properties: {
                            documentTypeId: { type: 'number', nullable: true },
                            fileName:       { type: 'string', minLength: 1 },
                            mimeType:       { type: 'string', minLength: 1 },
                            /** Base64-encoded content (with or without data-URI prefix). */
                            fileData:       { type: 'string', minLength: 1 },
                            shareable:      { type: 'boolean' },
                        },
                    },
                },
            },
        })
        body: CreateMigrantDocumentInput,
    ): Promise<MigrantDocumentDto> {
        const sub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        this.logger.info('[MigrantDocumentsController] create', {
            sub, fileName: body.fileName, mimeType: body.mimeType,
        });
        return this.documentService.create(sub, body);
    }

    // ── Get one ───────────────────────────────────────────────────────────────

    @get('/documents-migrant/{id}', {
        responses: {
            '200': {
                description: 'Single document with base64 binary.',
                content: { 'application/json': { schema: FULL_SCHEMA } },
            },
            '404': { description: 'Document not found.' },
        },
    })
    async getOne(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
    ): Promise<MigrantDocumentDto> {
        const sub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        this.logger.info('[MigrantDocumentsController] getOne', { sub, id });
        return this.documentService.getOne(sub, id);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    @put('/documents-migrant/{id}', {
        responses: {
            '200': {
                description: 'Updated document with full binary.',
                content: { 'application/json': { schema: FULL_SCHEMA } },
            },
            '404': { description: 'Document not found.' },
        },
    })
    async update(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            documentTypeId: { type: 'number', nullable: true },
                            fileName:       { type: 'string', minLength: 1 },
                            mimeType:       { type: 'string' },
                            /** Optional new base64 file to replace the existing binary. */
                            fileData:       { type: 'string' },
                            shareable:      { type: 'boolean' },
                        },
                    },
                },
            },
        })
        body: UpdateMigrantDocumentInput,
    ): Promise<MigrantDocumentDto> {
        const sub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        this.logger.info('[MigrantDocumentsController] update', { sub, id });
        return this.documentService.update(sub, id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/documents-migrant/{id}', {
        responses: {
            '204': { description: 'Document deleted.' },
            '404': { description: 'Document not found.' },
        },
    })
    async delete(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
    ): Promise<void> {
        const sub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        this.logger.warn('[MigrantDocumentsController] delete', { sub, id });
        return this.documentService.delete(sub, id);
    }
}
