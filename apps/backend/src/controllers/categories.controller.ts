/**
 * src/controllers/categories.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /categories?subtype=event|information    list → CategoryLegacy[]
 *   GET  /categories/count?subtype=               count
 *   POST /categories                              create → CategoryLegacy
 *   GET  /categories/to-production?id=            publish  ← BEFORE /:id
 *   GET  /categories/:id                          full → CategoryFull
 *   PUT  /categories/:id                          replace → 204
 *   PATCH /categories/:id                         partial → 204
 *   DELETE /categories/:id                        delete → 204 (409 if in use)
 *   GET  /categories-migrant?subtype=&defaultlang=&currentlang=   public
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator → all write endpoints
 *   pa_viewer             → GET list, GET /:id
 *   Public                → /categories-migrant
 *
 * ── Subtype filtering ────────────────────────────────────────────────────────
 *
 *   The `subtype` query parameter filters the list to either "event" or
 *   "information" categories. Omitting it returns all categories regardless
 *   of subtype — useful for admin views that need both.
 *
 *   The EventCategoriesPage passes ?subtype=event.
 *   The InformationCategoriesPage (future) will pass ?subtype=information.
 */

import {
    CountSchema,
    repository
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
} from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { CategoryLegacy } from '../models/category-legacy.model';
import { CategoryFull } from '../models/category-full.model';
import { CategoryFacadeService } from '../services/category-facade.service';
import { LanguageRepository } from '../repositories/language.repository';

const SUBTYPE_SCHEMA = {
    type: 'string' as const,
    enum: ['event', 'information'],
};

const STATUS_SCHEMA = {
    type: 'string' as const,
    enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
};

const TRANSLATIONS_MAP_SCHEMA = {
    type: 'object' as const,
    additionalProperties: {
        type: 'object' as const,
        required: ['title'],
        properties: {
            title: { type: 'string' as const },
            tStatus: { type: 'string' as const },
        },
    },
};

@authenticate('keycloak')
export class CategoriesController {
    constructor(
        @service(CategoryFacadeService)
        protected categoryFacadeService: CategoryFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,

        @repository(LanguageRepository)
        protected languageRepository: LanguageRepository,
    ) { }

    /** Returns the platform default language from the languages table. */
    protected async resolveDefaultLang(requested?: string): Promise<string> {
        if (requested) return requested;
        const def = await this.languageRepository.findOne({ where: { isDefault: true } });
        return def?.lang ?? 'en';
    }

    // ── Create ────────────────────────────────────────────────────────────────

    @post('/categories', {
        responses: {
            '200': {
                description: 'Created category (flat)',
                content: { 'application/json': { schema: getModelSchemaRef(CategoryLegacy) } },
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
                        required: ['subtype'],
                        additionalProperties: true,
                        properties: {
                            title: { type: 'string' },
                            sourceLang: { type: 'string' },
                            subtype: SUBTYPE_SCHEMA,
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: {
            title?: string;
            sourceLang?: string;
            subtype: 'event' | 'information';
            translations?: Record<string, { title: string }>;
        },
    ): Promise<CategoryLegacy> {
        this.logger.info('[CategoriesController.create]', {
            title: body.title, subtype: body.subtype,
        });
        return this.categoryFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/categories/count', {
        responses: {
            '200': {
                description: 'Category count (optionally filtered by subtype)',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'ngo_admin', 'ngo_operator'] })
    async count(
        @param.query.string('subtype') subtype?: 'event' | 'information',
    ): Promise<{ count: number }> {
        return this.categoryFacadeService.count(subtype);
    }

    // ── List ──────────────────────────────────────────────────────────────────

    /**
     * GET /categories?subtype=event|information
     *
     * Returns all categories, optionally filtered by subtype.
     * Used by:
     *   - EventCategoriesPage (?subtype=event)
     *   - Future InformationCategoriesPage (?subtype=information)
     *   - Event form filter dropdown (needs all event categories)
     *   - Public filter panels (?subtype=event on front-end event list)
     */
    @get('/categories', {
        responses: {
            '200': {
                description: 'Array of categories',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(CategoryLegacy) },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'ngo_admin', 'ngo_operator'] })
    async find(
        @param.query.string('subtype') subtype?: 'event' | 'information',
    ): Promise<CategoryLegacy[]> {
        return this.categoryFacadeService.find(subtype);
    }

    // ── Publish — registered BEFORE /:id ─────────────────────────────────────

    @get('/categories/to-production', {
        responses: { '200': { description: 'Category published to production' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[CategoriesController.publish]', { id });
        await this.categoryFacadeService.publish(id);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    @get('/categories/{id}', {
        responses: {
            '200': {
                description: 'Category with all translations',
                content: { 'application/json': { schema: getModelSchemaRef(CategoryFull) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'ngo_admin', 'ngo_operator'] })
    async findById(
        @param.path.number('id') id: number,
    ): Promise<CategoryFull> {
        this.logger.info('[CategoriesController.findById]', { id });
        return this.categoryFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    @put('/categories/{id}', {
        responses: { '204': { description: 'Category updated (full replace)' } },
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
        body: CategoryFull,
    ): Promise<void> {
        this.logger.info('[CategoriesController.replaceById]', {
            id, status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
        });
        await this.categoryFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    @patch('/categories/{id}', {
        responses: { '204': { description: 'Category partial update' } },
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
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                        },
                    },
                },
            },
        })
        body: Partial<CategoryLegacy>,
    ): Promise<void> {
        this.logger.info('[CategoriesController.updateById]', {
            id, fields: Object.keys(body),
        });
        await this.categoryFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    /**
     * DELETE /categories/:id
     *
     * Returns 409 Conflict if the category is still referenced by any
     * event or information item via content_item_relation (relationType='category').
     * The client should surface this error to the user explaining which items
     * need to be recategorized first.
     */
    @del('/categories/{id}', {
        responses: {
            '204': { description: 'Category deleted' },
            '409': { description: 'Category in use — cannot delete' },
        },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[CategoriesController.deleteById]', { id });
        await this.categoryFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * GET /categories-migrant?subtype=event&defaultlang=it&currentlang=it
     *
     * Public endpoint — published categories only, language-resolved.
     * Used by the migrant app filter panel.
     * @authenticate.skip()
     */
    @authenticate.skip()
    @get('/categories-migrant', {
        responses: {
            '200': {
                description: 'Published categories for migrant frontend',
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
                                    subtype: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async translatedCategories(
        @param.query.string('subtype') subtype?: 'event' | 'information',
        @param.query.string('defaultlang') defaultlang?: string,
        @param.query.string('currentlang') currentlang?: string,
    ): Promise<Array<{ id: number; title: string; lang: string; subtype: string }>> {
        const resolvedDefault = await this.resolveDefaultLang(defaultlang);
        return this.categoryFacadeService.getTranslatedForFrontend(resolvedDefault, currentlang ?? resolvedDefault, subtype);
    }
}