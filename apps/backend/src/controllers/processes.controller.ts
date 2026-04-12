/**
 * src/controllers/processes.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET    /processes?topicIds=&userTypeIds=&page=&pageSize=
 *   GET    /processes/count?...
 *   POST   /processes
 *   GET    /processes/to-production?id=          ← BEFORE /:id
 *   GET    /processes/:id
 *   PUT    /processes/:id
 *   PATCH  /processes/:id
 *   DELETE /processes/:id
 *   GET    /processes/:id/graph                  ← BEFORE /:id to avoid conflict
 *   PUT    /processes/:id/graph
 *   GET    /processes-migrant?...                (public, @authenticate.skip())
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator → all write endpoints + graph save
 *   pa_viewer             → GET list, GET /:id, GET /:id/graph
 *   micado_admin          → all endpoints
 *   Public                → /processes-migrant
 *
 * ── Graph endpoint notes ─────────────────────────────────────────────────────
 *
 *   GET /processes/:id/graph
 *     Returns full VueFlow-compatible { nodes, edges } object.
 *     Nodes carry all step translations for the form panel.
 *     Edges carry all step-link translations.
 *
 *   PUT /processes/:id/graph
 *     Body: { nodes: GraphNode[], edges: GraphEdge[] }
 *     Atomically deletes all existing steps/step-links for this process
 *     and re-inserts the complete graph. Returns 204.
 *     Frontend re-fetches GET /graph afterwards to get stable numeric IDs.
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
import { ProcessLegacy } from '../models/process-legacy.model';
import { ProcessFull } from '../models/process-full.model';
import { ProcessGraph } from '../models/process-graph.model';
import { ProcessFacadeService, type ProcessListFilter } from '../services/process-facade.service';
import { LanguageRepository } from '../repositories/language.repository';

// ── Shared JSON schema fragments ──────────────────────────────────────────────

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
            description: { type: 'string' as const },
            tStatus: { type: 'string' as const },
        },
    },
};

const GRAPH_NODE_SCHEMA = {
    type: 'object' as const,
    required: ['id', 'position', 'data'],
    properties: {
        id: { type: 'string' as const },
        type: { type: 'string' as const },
        position: {
            type: 'object' as const,
            required: ['x', 'y'],
            properties: {
                x: { type: 'number' as const },
                y: { type: 'number' as const },
            },
        },
        data: { type: 'object' as const, additionalProperties: true },
    },
};

const GRAPH_EDGE_SCHEMA = {
    type: 'object' as const,
    required: ['id', 'source', 'target'],
    properties: {
        id: { type: 'string' as const },
        source: { type: 'string' as const },
        target: { type: 'string' as const },
        type: { type: 'string' as const },
        label: { type: 'string' as const },
        data: { type: 'object' as const, additionalProperties: true },
    },
};

const GRAPH_BODY_SCHEMA = {
    type: 'object' as const,
    required: ['nodes', 'edges'],
    properties: {
        nodes: { type: 'array' as const, items: GRAPH_NODE_SCHEMA },
        edges: { type: 'array' as const, items: GRAPH_EDGE_SCHEMA },
    },
};

// ── Controller ────────────────────────────────────────────────────────────────

@authenticate('keycloak')
export class ProcessesController {
    constructor(
        @service(ProcessFacadeService)
        protected processFacadeService: ProcessFacadeService,

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

    @post('/processes', {
        responses: {
            '200': {
                description: 'Created process (flat)',
                content: { 'application/json': { schema: getModelSchemaRef(ProcessLegacy) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'micado_admin'] })
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
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            producedDocTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Parameters<ProcessFacadeService['create']>[0],
    ): Promise<ProcessLegacy> {
        this.logger.info('[ProcessesController.create]', { title: body.title });
        return this.processFacadeService.create(body);
    }

    // ── Count — before list to prevent route ambiguity ────────────────────────

    @get('/processes/count', {
        responses: {
            '200': {
                description: 'Process count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'micado_admin'] })
    async count(
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
    ): Promise<{ count: number }> {
        return this.processFacadeService.count(this.parseFilter({ topicIds, userTypeIds }));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/processes', {
        responses: {
            '200': {
                description: 'Paginated process list',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(ProcessLegacy) },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'micado_admin'] })
    async find(
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
        @param.query.number('page') page?: number,
        @param.query.number('pageSize') pageSize?: number,
    ): Promise<ProcessLegacy[]> {
        return this.processFacadeService.find(
            this.parseFilter({ topicIds, userTypeIds, page, pageSize }),
        );
    }

    // ── Publish — BEFORE /:id to avoid route collision ────────────────────────

    @get('/processes/to-production', {
        responses: { '200': { description: 'Process published to production' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'micado_admin'] })
    async publish(@param.query.number('id') id: number): Promise<void> {
        this.logger.info('[ProcessesController.publish]', { id });
        await this.processFacadeService.publish(id);
    }

    // ── Graph GET — must come before /:id ─────────────────────────────────────

    @get('/processes/{id}/graph', {
        responses: {
            '200': {
                description: 'VueFlow-compatible graph (nodes + edges) for a process',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                nodes: { type: 'array', items: GRAPH_NODE_SCHEMA },
                                edges: { type: 'array', items: GRAPH_EDGE_SCHEMA },
                            },
                        },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'micado_admin'] })
    async getGraph(@param.path.number('id') id: number): Promise<ProcessGraph> {
        this.logger.info('[ProcessesController.getGraph]', { id });
        return this.processFacadeService.getGraph(id);
    }

    // ── Graph PUT ─────────────────────────────────────────────────────────────

    @put('/processes/{id}/graph', {
        responses: { '204': { description: 'Graph saved atomically (all steps + step-links replaced)' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'micado_admin'] })
    async saveGraph(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': { schema: GRAPH_BODY_SCHEMA },
            },
        })
        body: ProcessGraph,
    ): Promise<void> {
        this.logger.info('[ProcessesController.saveGraph]', {
            id, nodes: body.nodes?.length ?? 0, edges: body.edges?.length ?? 0,
        });
        await this.processFacadeService.saveGraph(id, body);
    }

    // ── Single item ───────────────────────────────────────────────────────────

    @get('/processes/{id}', {
        responses: {
            '200': {
                description: 'Process with all translations and relations',
                content: { 'application/json': { schema: getModelSchemaRef(ProcessFull) } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer', 'micado_admin'] })
    async findById(@param.path.number('id') id: number): Promise<ProcessFull> {
        this.logger.info('[ProcessesController.findById]', { id });
        return this.processFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    @put('/processes/{id}', {
        responses: { '204': { description: 'Process metadata updated' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'micado_admin'] })
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
                            topicIds: { type: 'array', items: { type: 'number' } },
                            userTypeIds: { type: 'array', items: { type: 'number' } },
                            producedDocTypeIds: { type: 'array', items: { type: 'number' } },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: ProcessFull,
    ): Promise<void> {
        this.logger.info('[ProcessesController.replaceById]', {
            id, status: body.status, langs: Object.keys(body.translations ?? {}),
        });
        await this.processFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    @patch('/processes/{id}', {
        responses: { '204': { description: 'Process partial update' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'micado_admin'] })
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
        body: Parameters<ProcessFacadeService['updateById']>[1],
    ): Promise<void> {
        this.logger.info('[ProcessesController.updateById]', { id, fields: Object.keys(body) });
        await this.processFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/processes/{id}', {
        responses: { '204': { description: 'Process and all its steps/step-links deleted' } },
    })
    @authorize({ allowedRoles: ['pa_admin', 'micado_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[ProcessesController.deleteById]', { id });
        await this.processFacadeService.deleteById(id);
    }

    // ── Migrant frontend (public) ─────────────────────────────────────────────

    @authenticate.skip()
    @get('/processes-migrant', {
        responses: {
            '200': {
                description: 'Published processes for migrant frontend',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    },
                },
            },
        },
    })
    async translatedProcesses(
        @param.query.string('defaultlang') defaultlang?: string,
        @param.query.string('currentlang') currentlang?: string,
        @param.query.string('topicIds') topicIds?: string,
        @param.query.string('userTypeIds') userTypeIds?: string,
        @param.query.number('page') page?: number,
        @param.query.number('pageSize') pageSize?: number,
    ): Promise<Array<Record<string, unknown>>> {
        const filter = this.parseFilter({ topicIds, userTypeIds, page, pageSize });
        const resolvedDefault = await this.resolveDefaultLang(defaultlang);
        return this.processFacadeService.getTranslatedForFrontend(resolvedDefault, currentlang ?? resolvedDefault, filter);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private parseFilter(raw: {
        topicIds?: string;
        userTypeIds?: string;
        page?: number;
        pageSize?: number;
    }): ProcessListFilter {
        const parseIds = (val?: string): number[] | undefined => {
            if (!val) return undefined;
            const ids = val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            return ids.length ? ids : undefined;
        };
        return {
            topicIds: parseIds(raw.topicIds),
            userTypeIds: parseIds(raw.userTypeIds),
            page: raw.page ?? 1,
            pageSize: Math.min(raw.pageSize ?? 20, 100),
        };
    }
}