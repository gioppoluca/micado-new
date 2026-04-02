/**
 * src/controllers/glossaries.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /glossaries                    list — GlossaryLegacy[]
 *   GET  /glossaries/count              count
 *   POST /glossaries                    create
 *   GET  /glossaries/to-production?id   publish  ← registered BEFORE /:id
 *   GET  /glossaries/:id                single — GlossaryFull (all translations)
 *   PUT  /glossaries/:id                full replace — 204
 *   PATCH /glossaries/:id               partial (status toggle) — 204
 *   DELETE /glossaries/:id              delete — 204
 *   GET  /glossaries-migrant            migrant frontend — published, lang-resolved
 *   GET  /glossary-items                mention picker — lightweight, all statuses
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator  → all write endpoints
 *   pa_viewer              → read-only (GET list, GET /:id)
 *   Public (no auth)       → /glossaries-migrant, /glossary-items
 *
 * ── /glossary-items ──────────────────────────────────────────────────────────
 *
 *   Public endpoint consumed by the RichTextEditor @-mention suggestion
 *   system (src/api/micado-entities.api.ts). Returns a lightweight list
 *   with { id, title, lang, published } for all GLOSSARY items regardless
 *   of publish status (editors need draft terms too).
 *   Supports ?defaultlang and ?currentlang query params.
 */

import {
    CountSchema,
    Filter,
    FilterExcludingWhere,
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
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { GlossaryLegacy } from '../models/glossary-legacy.model';
import { GlossaryFull } from '../models/glossary-full.model';
import { GlossaryFacadeService } from '../services/glossary-facade.service';

// ─── Reusable inline schema fragments ─────────────────────────────────────────

const TRANSLATION_ENTRY_SCHEMA: SchemaObject = {
    type: 'object',
    required: ['title'],
    properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        tStatus: { type: 'string', enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    },
    additionalProperties: true,
};

const TRANSLATIONS_MAP_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: TRANSLATION_ENTRY_SCHEMA,
};

const STATUS_SCHEMA: SchemaObject = {
    type: 'string',
    enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
};

@authenticate('keycloak')
export class GlossariesController {
    constructor(
        @service(GlossaryFacadeService)
        protected glossaryFacadeService: GlossaryFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * POST /glossaries
     *
     * Creates a new glossary term. The optional `translations` map allows
     * the bulk CSV import to persist all language content in a single POST.
     */
    @post('/glossaries', {
        responses: {
            '200': {
                description: 'Created glossary term (flat, sourceLang only)',
                content: { 'application/json': { schema: getModelSchemaRef(GlossaryLegacy) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    async create(
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            title: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Omit<GlossaryLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<GlossaryLegacy> {
        this.logger.info('[GlossariesController.create]', { title: body.title });
        return this.glossaryFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/glossaries/count', {
        responses: {
            '200': {
                description: 'Glossary term count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async count(): Promise<{ count: number }> {
        return this.glossaryFacadeService.count();
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/glossaries', {
        responses: {
            '200': {
                description: 'Array of glossary terms (flat, sourceLang only)',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(GlossaryLegacy) },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async find(
        @param.filter(GlossaryLegacy) _filter?: Filter<GlossaryLegacy>,
    ): Promise<GlossaryLegacy[]> {
        return this.glossaryFacadeService.find();
    }

    // ── Publish — registered BEFORE /{id} ─────────────────────────────────────

    @get('/glossaries/to-production', {
        responses: { '200': { description: 'Glossary term published to production' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[GlossariesController.publish]', { id });
        await this.glossaryFacadeService.publish(id);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    @get('/glossaries/{id}', {
        responses: {
            '200': {
                description: 'Glossary term with all translations',
                content: { 'application/json': { schema: getModelSchemaRef(GlossaryFull) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async findById(
        @param.path.number('id') id: number,
        @param.filter(GlossaryFull, { exclude: 'where' })
        _filter?: FilterExcludingWhere<GlossaryFull>,
    ): Promise<GlossaryFull> {
        this.logger.info('[GlossariesController.findById]', { id });
        return this.glossaryFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    @put('/glossaries/{id}', {
        responses: { '204': { description: 'Glossary term updated (full replace)' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
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
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: GlossaryFull,
    ): Promise<void> {
        this.logger.info('[GlossariesController.replaceById]', {
            id, status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
        });
        await this.glossaryFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    @patch('/glossaries/{id}', {
        responses: { '204': { description: 'Glossary term partial update' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    async updateById(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            title: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                        },
                    },
                },
            },
        })
        body: Partial<GlossaryLegacy>,
    ): Promise<void> {
        this.logger.info('[GlossariesController.updateById]', {
            id, fields: Object.keys(body),
        });
        await this.glossaryFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/glossaries/{id}', {
        responses: { '204': { description: 'Glossary term deleted' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[GlossariesController.deleteById]', { id });
        await this.glossaryFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * GET /glossaries-migrant
     * Published terms only, resolved to the best available language.
     * @authenticate.skip() — public endpoint.
     */
    @authenticate.skip()
    @get('/glossaries-migrant', {
        responses: {
            '200': {
                description: 'Published glossary terms for migrant frontend',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    title: { type: 'string' },
                                    description: { type: 'string' },
                                    lang: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async translatedGlossary(
        @param.query.string('defaultlang') defaultlang = 'it',
        @param.query.string('currentlang') currentlang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        return this.glossaryFacadeService.getTranslatedForFrontend(defaultlang, currentlang);
    }

    // ── Mention picker ────────────────────────────────────────────────────────

    /**
     * GET /glossary-items
     *
     * Lightweight list for the RichTextEditor @-mention suggestion system.
     * Returns all terms (published + draft) so editors can cross-reference
     * terms while writing. Already referenced by micado-entities.api.ts.
     *
     * @authenticate.skip() — editors need this before auth token is ready.
     */
    @authenticate.skip()
    @get('/glossary-items', {
        responses: {
            '200': {
                description: 'Glossary items for mention picker',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    title: { type: 'string' },
                                    lang: { type: 'string' },
                                    published: { type: 'boolean' },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async mentionPickerList(
        @param.query.string('defaultlang') defaultlang = 'it',
        @param.query.string('currentlang') currentlang = 'it',
        @param.query.boolean('includeDraft') includeDraft = true,
    ): Promise<Array<{ id: number; title: string; lang: string; published: boolean }>> {
        return this.glossaryFacadeService.getForMentionPicker(defaultlang, currentlang, includeDraft);
    }
}