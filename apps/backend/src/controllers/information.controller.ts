/**
 * src/controllers/information.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /information?categoryId=&topicIds=&userTypeIds=&page=&pageSize=
 *   GET  /information/count?...
 *   POST /information
 *   GET  /information/to-production?id=       ← BEFORE /:id
 *   GET  /information/:id
 *   PUT  /information/:id
 *   PATCH /information/:id
 *   DELETE /information/:id
 *   GET  /information-migrant?...             (public, @authenticate.skip())
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator → all write endpoints
 *   pa_viewer             → GET list, GET /:id
 *   Public                → /information-migrant
 *
 * ── Filters (AND-combined) ────────────────────────────────────────────────────
 *
 *   categoryId   — single information category id
 *   topicIds     — comma-separated e.g. "1,2,3"
 *   userTypeIds  — comma-separated e.g. "1,2"
 *   page         — 1-indexed (default 1)
 *   pageSize     — max 100 (default 20)
 */

import { CountSchema, repository } from '@loopback/repository';
import {
    del, get, getModelSchemaRef, param,
    patch, post, put, requestBody,
} from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { LanguageRepository } from '../repositories';
import { InformationLegacy } from '../models/information-legacy.model';
import { InformationFull } from '../models/information-full.model';
import { InformationFacadeService, type InformationListFilter } from '../services/information-facade.service';

const STATUS_SCHEMA = { type: 'string' as const, enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] };
const TRANSLATIONS_MAP_SCHEMA = {
    type: 'object' as const,
    additionalProperties: {
        type: 'object' as const,
        required: ['title'],
        properties: {
            title: { type: 'string' as const },
            description: { type: 'string' as const },
            tStatus: { type: 'string' as const },
        },
    },
};

@authenticate('keycloak')
export class InformationController {
    constructor(
        @service(InformationFacadeService)
        protected informationFacadeService: InformationFacadeService,

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

    @post('/information', {
        responses: {
            '200': {
                description: 'Created information item (flat)',
                content: { 'application/json': { schema: getModelSchemaRef(InformationLegacy) } },
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
                            sourceLang: { type: 'string' },
                            categoryId: { type: 'number', nullable: true },
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Parameters<InformationFacadeService['create']>[0],
    ): Promise<InformationLegacy> {
        this.logger.info('[InformationController.create]', { title: body.title });
        return this.informationFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/information/count', {
        responses: {
            '200': {
                description: 'Information item count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async count(
        @param.query.number('categoryId') categoryId?: number,
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
    ): Promise<{ count: number }> {
        return this.informationFacadeService.count(this.parseFilter({ categoryId, topicIds, userTypeIds }));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/information', {
        responses: {
            '200': {
                description: 'Paginated information items with resolved relations',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(InformationLegacy) },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async find(
        @param.query.number('categoryId') categoryId?: number,
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
        @param.query.number('page') page?: number,
        @param.query.number('pageSize') pageSize?: number,
    ): Promise<InformationLegacy[]> {
        return this.informationFacadeService.find(this.parseFilter({ categoryId, topicIds, userTypeIds, page, pageSize }));
    }

    // ── Publish — BEFORE /:id ─────────────────────────────────────────────────

    @get('/information/to-production', {
        responses: { '200': { description: 'Information item published to production' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async publish(@param.query.number('id') id: number): Promise<void> {
        this.logger.info('[InformationController.publish]', { id });
        await this.informationFacadeService.publish(id);
    }

    // ── Single item ───────────────────────────────────────────────────────────

    @get('/information/{id}', {
        responses: {
            '200': {
                description: 'Information item with all translations and relations',
                content: { 'application/json': { schema: getModelSchemaRef(InformationFull) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async findById(@param.path.number('id') id: number): Promise<InformationFull> {
        this.logger.info('[InformationController.findById]', { id });
        return this.informationFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    @put('/information/{id}', {
        responses: { '204': { description: 'Information item updated' } },
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
                            categoryId: { type: 'number', nullable: true },
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: InformationFull,
    ): Promise<void> {
        this.logger.info('[InformationController.replaceById]', {
            id, status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
        });
        await this.informationFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    @patch('/information/{id}', {
        responses: { '204': { description: 'Information item partial update' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    async updateById(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                        },
                    },
                },
            },
        })
        body: Parameters<InformationFacadeService['updateById']>[1],
    ): Promise<void> {
        this.logger.info('[InformationController.updateById]', { id, fields: Object.keys(body) });
        await this.informationFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/information/{id}', {
        responses: { '204': { description: 'Information item deleted' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[InformationController.deleteById]', { id });
        await this.informationFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    @authenticate.skip()
    @get('/information-migrant', {
        responses: {
            '200': {
                description: 'Published information items for migrant frontend, paginated',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    },
                },
            },
        },
    })
    async translatedInformation(
        @param.query.string('defaultlang') defaultlang?: string,
        @param.query.string('currentlang') currentlang?: string,
        @param.query.number('categoryId') categoryId?: number,
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
        @param.query.number('page') page?: number,
        @param.query.number('pageSize') pageSize?: number,
    ): Promise<Array<Record<string, unknown>>> {
        const filter = this.parseFilter({ categoryId, topicIds, userTypeIds, page, pageSize });
        const resolvedDefault = await this.resolveDefaultLang(defaultlang);
        return this.informationFacadeService.getTranslatedForFrontend(
            resolvedDefault, currentlang ?? resolvedDefault, filter,
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private parseFilter(raw: {
        categoryId?: number;
        topicIds?: string;
        userTypeIds?: string;
        page?: number;
        pageSize?: number;
    }): InformationListFilter {
        const parseIds = (val?: string): number[] | undefined => {
            if (!val) return undefined;
            const ids = val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            return ids.length ? ids : undefined;
        };
        return {
            categoryId: raw.categoryId,
            topicIds: parseIds(raw.topicIds),
            userTypeIds: parseIds(raw.userTypeIds),
            page: raw.page ?? 1,
            pageSize: Math.min(raw.pageSize ?? 20, 100),
        };
    }
}