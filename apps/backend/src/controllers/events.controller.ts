/**
 * src/controllers/events.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /events?categoryId=&topicIds[]=&userTypeIds[]=&page=&pageSize=
 *                                        list with filters + pagination
 *   GET  /events/count?...               count (same filters, no pagination)
 *   POST /events                         create → EventLegacy
 *   GET  /events/to-production?id=       publish  ← BEFORE /:id
 *   GET  /events/:id                     full → EventFull
 *   PUT  /events/:id                     full replace → 204
 *   PATCH /events/:id                    partial (status/metadata) → 204
 *   DELETE /events/:id                   delete → 204
 *   GET  /events-migrant?...             public, published + filtered + paginated
 *
 * ── Filters ──────────────────────────────────────────────────────────────────
 *
 *   categoryId   — single category (event subtype), AND with others
 *   topicIds     — comma-separated or repeated param, AND semantics
 *   userTypeIds  — comma-separated or repeated param, AND semantics
 *   page         — 1-indexed (default 1)
 *   pageSize     — items per page (default 20, max 100)
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator → all write endpoints
 *   pa_viewer             → GET list, GET /:id
 *   Public                → /events-migrant
 */

import {
    CountSchema,
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
import { EventLegacy } from '../models/event-legacy.model';
import { EventFull } from '../models/event-full.model';
import { EventFacadeService, type EventListFilter } from '../services/event-facade.service';

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
const DATA_EXTRA_SCHEMA = {
    type: 'object' as const,
    properties: {
        startDate: { type: 'string' as const },
        endDate: { type: 'string' as const },
        location: { type: 'string' as const },
        cost: { type: 'string' as const, nullable: true },
        isFree: { type: 'boolean' as const },
    },
};

@authenticate('keycloak')
export class EventsController {
    constructor(
        @service(EventFacadeService)
        protected eventFacadeService: EventFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Create ────────────────────────────────────────────────────────────────

    @post('/events', {
        responses: {
            '200': {
                description: 'Created event (flat)',
                content: { 'application/json': { schema: getModelSchemaRef(EventLegacy) } },
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
                            dataExtra: DATA_EXTRA_SCHEMA,
                            categoryId: { type: 'number', nullable: true },
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Parameters<EventFacadeService['create']>[0],
    ): Promise<EventLegacy> {
        this.logger.info('[EventsController.create]', { title: body.title });
        return this.eventFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/events/count', {
        responses: {
            '200': {
                description: 'Event count (same filters as list, no pagination)',
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
        const filter = this.parseFilter({ categoryId, topicIds, userTypeIds });
        return this.eventFacadeService.count(filter);
    }

    // ── List ──────────────────────────────────────────────────────────────────

    /**
     * GET /events
     *
     * Returns events with optional AND-combined filters.
     * The filter values (categoryId, topicIds, userTypeIds) are loaded
     * dynamically from GET /categories?subtype=event, GET /topics, GET /user-types
     * so the filter panel is always consistent with the DB content.
     */
    @get('/events', {
        responses: {
            '200': {
                description: 'Paginated array of events (flat, sourceLang + relations)',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(EventLegacy) },
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
    ): Promise<EventLegacy[]> {
        const filter = this.parseFilter({ categoryId, topicIds, userTypeIds, page, pageSize });
        return this.eventFacadeService.find(filter);
    }

    // ── Publish — registered BEFORE /:id ─────────────────────────────────────

    @get('/events/to-production', {
        responses: { '200': { description: 'Event published to production' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[EventsController.publish]', { id });
        await this.eventFacadeService.publish(id);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    @get('/events/{id}', {
        responses: {
            '200': {
                description: 'Event with all translations and resolved relations',
                content: { 'application/json': { schema: getModelSchemaRef(EventFull) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async findById(
        @param.path.number('id') id: number,
    ): Promise<EventFull> {
        this.logger.info('[EventsController.findById]', { id });
        return this.eventFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    @put('/events/{id}', {
        responses: { '204': { description: 'Event updated (full replace)' } },
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
                            dataExtra: DATA_EXTRA_SCHEMA,
                            categoryId: { type: 'number', nullable: true },
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: EventFull,
    ): Promise<void> {
        this.logger.info('[EventsController.replaceById]', {
            id, status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
            categoryId: body.categoryId,
            topics: body.topicIds?.length ?? 0,
            userTypes: body.userTypeIds?.length ?? 0,
        });
        await this.eventFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    @patch('/events/{id}', {
        responses: { '204': { description: 'Event partial update' } },
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
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Parameters<EventFacadeService['updateById']>[1],
    ): Promise<void> {
        this.logger.info('[EventsController.updateById]', { id, fields: Object.keys(body) });
        await this.eventFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/events/{id}', {
        responses: { '204': { description: 'Event deleted' } },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[EventsController.deleteById]', { id });
        await this.eventFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * GET /events-migrant
     *
     * Public endpoint — published events only, language-resolved, paginated.
     * Supports the same AND-combined filters as /events.
     * @authenticate.skip()
     */
    @authenticate.skip()
    @get('/events-migrant', {
        responses: {
            '200': {
                description: 'Published events for migrant frontend, paginated',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: { type: 'object', additionalProperties: true },
                        },
                    },
                },
            },
        },
    })
    async translatedEvents(
        @param.query.string('defaultlang') defaultlang = 'it',
        @param.query.string('currentlang') currentlang = 'it',
        @param.query.number('categoryId') categoryId?: number,
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
        @param.query.number('page') page?: number,
        @param.query.number('pageSize') pageSize?: number,
    ): Promise<Array<Record<string, unknown>>> {
        const filter = this.parseFilter({ categoryId, topicIds, userTypeIds, page, pageSize });
        return this.eventFacadeService.getTranslatedForFrontend(defaultlang, currentlang, filter);
    }

    // ── Query param helpers ───────────────────────────────────────────────────

    /**
     * Parses comma-separated or repeated query params for multi-value filters.
     * Supports both ?topicIds=1,2,3 and ?topicIds[]=1&topicIds[]=2.
     */
    private parseFilter(raw: {
        categoryId?: number;
        topicIds?: string;
        userTypeIds?: string;
        page?: number;
        pageSize?: number;
    }): EventListFilter {
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
            pageSize: Math.min(raw.pageSize ?? 20, 100), // cap at 100
        };
    }
}