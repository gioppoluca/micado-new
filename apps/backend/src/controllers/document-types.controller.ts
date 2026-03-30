/**
 * src/controllers/document-types.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /document-types                    list — DocumentTypeLegacy[]
 *   GET  /document-types/count              count
 *   POST /document-types                    create
 *   GET  /document-types/to-production?id   publish workflow  ← registered BEFORE /:id
 *   GET  /document-types/:id                single — DocumentTypeFull (all translations)
 *   PUT  /document-types/:id                full replace — 204
 *   PATCH /document-types/:id               partial update — 204
 *   DELETE /document-types/:id              delete — 204
 *   GET  /document-types-migrant            migrant frontend — published, lang-resolved
 *
 * ── Route ordering note ───────────────────────────────────────────────────────
 *
 *   /to-production is registered before /{id} to prevent LoopBack's router
 *   from matching the literal string "to-production" as a numeric :id parameter,
 *   which would cause a NaN lookup and a misleading 404.
 *
 * ── Why write endpoints use inline schemas ────────────────────────────────────
 *
 *   getModelSchemaRef() emits a JSON Schema $ref. LoopBack's AJV validator
 *   resolves that $ref at runtime with additionalProperties:false, which
 *   rejects `translations` (not declared on DocumentTypeLegacy) and any
 *   unlisted property on DocumentTypeFull translation entries.
 *
 *   Fix: inline schemas for POST, PUT, PATCH. Read endpoints still use
 *   getModelSchemaRef — AJV does not validate response bodies.
 */

import {
    CountSchema,
    Filter,
    FilterExcludingWhere,
    Where,
} from '@loopback/repository';
import {
    del,
    get,
    getModelSchemaRef,
    param,
    patch,
    post,
    put,
    requestBody,
    SchemaObject,
} from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { inject, service } from '@loopback/core';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { DocumentTypeLegacy } from '../models/document-type-legacy.model';
import { DocumentTypeFull } from '../models/document-type-full.model';
import { DocumentTypeFacadeService } from '../services/document-type-facade.service';

// ─── Reusable inline schema fragments ─────────────────────────────────────────

/** Per-language translation entry. */
const TRANSLATION_ENTRY_SCHEMA: SchemaObject = {
    type: 'object',
    required: ['title'],
    properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        tStatus: {
            type: 'string',
            enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'],
        },
    },
    additionalProperties: true,
};

/** Map of lang code → TranslationEntry. */
const TRANSLATIONS_MAP_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: TRANSLATION_ENTRY_SCHEMA,
};

/**
 * Opaque data_extra bag.
 * Expected keys: icon, issuer, model_template, validable, validity_duration.
 */
const DATA_EXTRA_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: true,
};

/** Revision lifecycle status enum. */
const STATUS_SCHEMA: SchemaObject = {
    type: 'string',
    enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
};

@authenticate('keycloak')
export class DocumentTypesController {
    constructor(
        @service(DocumentTypeFacadeService)
        protected documentTypeFacadeService: DocumentTypeFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * POST /document-types
     *
     * Creates a new document type. The optional `translations` map allows the
     * PA form to persist all language content in a single POST — no follow-up
     * PUT needed for new records.
     */
    @post('/document-types', {
        responses: {
            '200': {
                description: 'Created DocumentType (flat, sourceLang only)',
                content: {
                    'application/json': { schema: getModelSchemaRef(DocumentTypeLegacy) },
                },
            },
        },
    })
    async create(
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            document: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Omit<DocumentTypeLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<DocumentTypeLegacy> {
        this.logger.info('[DocumentTypesController.create]', {
            document: body.document,
        });
        return this.documentTypeFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/document-types/count', {
        responses: {
            '200': {
                description: 'DocumentType count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    async count(
        @param.where(DocumentTypeLegacy) where?: Where<DocumentTypeLegacy>,
    ): Promise<{ count: number }> {
        return this.documentTypeFacadeService.count(where as Record<string, unknown>);
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/document-types', {
        responses: {
            '200': {
                description: 'Array of DocumentType (flat, sourceLang only)',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: getModelSchemaRef(DocumentTypeLegacy),
                        },
                    },
                },
            },
        },
    })
    async find(
        @param.filter(DocumentTypeLegacy) filter?: Filter<DocumentTypeLegacy>,
    ): Promise<DocumentTypeLegacy[]> {
        return this.documentTypeFacadeService.find(filter);
    }

    // ── Publish workflow — registered BEFORE /{id} ────────────────────────────

    /**
     * GET /document-types/to-production?id=n
     *
     * Promotes the APPROVED revision to PUBLISHED.
     * Must be registered before /{id} to prevent the router matching
     * "to-production" as a numeric id.
     */
    @get('/document-types/to-production', {
        responses: {
            '200': { description: 'DocumentType published to production' },
        },
    })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[DocumentTypesController.publish]', { id });
        await this.documentTypeFacadeService.publish(id);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    /**
     * GET /document-types/:id
     *
     * Returns DocumentTypeFull with ALL per-language translations embedded
     * and the version history. One round-trip — the PA form needs no second call.
     */
    @get('/document-types/{id}', {
        responses: {
            '200': {
                description: 'DocumentType with all translations (form context)',
                content: {
                    'application/json': { schema: getModelSchemaRef(DocumentTypeFull) },
                },
            },
        },
    })
    async findById(
        @param.path.number('id') id: number,
        @param.filter(DocumentTypeFull, { exclude: 'where' })
        _filter?: FilterExcludingWhere<DocumentTypeFull>,
    ): Promise<DocumentTypeFull> {
        this.logger.info('[DocumentTypesController.findById]', { id });
        return this.documentTypeFacadeService.findById(id);
    }

    // ── Full replace (form save) ──────────────────────────────────────────────

    /**
     * PUT /document-types/:id
     *
     * Replaces the full document type: metadata (dataExtra) + all translations
     * in one call. Used by the PA form Save button.
     *
     * Languages absent from body.translations are NOT deleted — only upserted.
     */
    @put('/document-types/{id}', {
        responses: { '204': { description: 'DocumentType updated (full replace)' } },
    })
    async replaceById(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            id: { type: 'number' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: DocumentTypeFull,
    ): Promise<void> {
        this.logger.info('[DocumentTypesController.replaceById]', {
            id,
            status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
        });
        await this.documentTypeFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    /**
     * PATCH /document-types/:id
     *
     * Partial update — status toggle from list row, icon change, validable
     * toggle, or other single-field patches. Does NOT touch translations.
     */
    @patch('/document-types/{id}', {
        responses: { '204': { description: 'DocumentType partial update' } },
    })
    async updateById(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            document: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Partial<DocumentTypeLegacy>,
    ): Promise<void> {
        this.logger.info('[DocumentTypesController.updateById]', {
            id,
            fields: Object.keys(body),
        });
        await this.documentTypeFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/document-types/{id}', {
        responses: { '204': { description: 'DocumentType deleted' } },
    })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[DocumentTypesController.deleteById]', { id });
        await this.documentTypeFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * GET /document-types-migrant
     *
     * Returns PUBLISHED document types resolved to the best available language.
     * Language resolution: currentLang → defaultLang (fallback).
     *
     * Response shape matches the legacy document_type JOIN query so the
     * migrant frontend requires no changes.
     *
     * @authenticate.skip() — public endpoint, no auth token required.
     */
    @authenticate.skip()
    @get('/document-types-migrant', {
        responses: {
            '200': {
                description: 'Published document types for migrant frontend (lang-resolved)',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    document: { type: 'string' },
                                    description: { type: 'string' },
                                    lang: { type: 'string' },
                                    icon: { type: 'string' },
                                    issuer: { type: 'string' },
                                    validable: { type: 'boolean' },
                                    validity_duration: { type: 'number' },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async translatedunion(
        @param.query.string('defaultlang') defaultlang = 'it',
        @param.query.string('currentlang') currentlang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        return this.documentTypeFacadeService.getTranslatedForFrontend(
            defaultlang,
            currentlang,
        );
    }
}