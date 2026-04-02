/**
 * src/controllers/topics.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /topics                    list — TopicLegacy[] (lean, sourceLang only)
 *   GET  /topics/count              count
 *   POST /topics                    create — flat fields + optional translations map
 *   GET  /topics/to-production?id   publish workflow   ← registered BEFORE /:id
 *   GET  /topics/:id                single — TopicFull (all translations + depth)
 *   PUT  /topics/:id                full replace — TopicFull shape, 204
 *   PATCH /topics/:id               partial update (status toggle, icon, parentId), 204
 *   DELETE /topics/:id              delete (guarded: fails if topic has children), 204
 *   GET  /topics-migrant            migrant frontend — published, lang-resolved
 *
 * ── Role-based access ────────────────────────────────────────────────────────
 *
 *   pa_admin, pa_operator → all write endpoints
 *   pa_viewer             → read only (GET list + GET /:id)
 *   Any authenticated     → same as pa_viewer for this resource
 *   Public (no auth)      → /topics-migrant only
 *
 * ── Parent / depth semantics ─────────────────────────────────────────────────
 *
 *   parentId in responses is the numeric external_key of the parent topic (or null).
 *   depth is 0-based: root = 0, first child = 1, …
 *   The setting key 'topic.max_depth' in app_settings controls the frontend
 *   tree picker's selectable levels — this controller does NOT enforce it at
 *   write time.  Enforcement is presentational only.
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
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import { TopicLegacy } from '../models/topic-legacy.model';
import { TopicFull } from '../models/topic-full.model';
import { TopicFacadeService } from '../services/topic-facade.service';

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

const DATA_EXTRA_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: true,
};

const STATUS_SCHEMA: SchemaObject = {
    type: 'string',
    enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
};

@authenticate('keycloak')
export class TopicsController {
    constructor(
        @service(TopicFacadeService)
        protected topicFacadeService: TopicFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * POST /topics
     *
     * Creates a new topic. The optional `translations` map allows the PA form
     * to persist all language content in a single POST.
     * `parentId` (numeric external_key) links to the parent topic, or null for root.
     */
    @post('/topics', {
        responses: {
            '200': {
                description: 'Created Topic (flat, sourceLang only)',
                content: {
                    'application/json': { schema: getModelSchemaRef(TopicLegacy) },
                },
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
                            topic: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                            parentId: { type: 'number', nullable: true },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Omit<TopicLegacy, 'id' | 'status' | 'depth'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<TopicLegacy> {
        this.logger.info('[TopicsController.create]', { topic: body.topic, parentId: body.parentId });
        return this.topicFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/topics/count', {
        responses: {
            '200': {
                description: 'Topic count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async count(
        @param.where(TopicLegacy) _where?: Where<TopicLegacy>,
    ): Promise<{ count: number }> {
        return this.topicFacadeService.count();
    }

    // ── List ──────────────────────────────────────────────────────────────────

    /**
     * GET /topics
     *
     * Returns all topics as flat list with parentId and depth fields.
     * The frontend uses this to build the tree locally with vue3-treeselect.
     *
     * Role map:
     *   pa_admin, pa_operator → full list (all statuses)
     *   pa_viewer             → full list (all statuses, read-only intent)
     */
    @get('/topics', {
        responses: {
            '200': {
                description: 'Array of Topics (flat, with parentId and depth)',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: getModelSchemaRef(TopicLegacy),
                        },
                    },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async find(
        @param.filter(TopicLegacy) _filter?: Filter<TopicLegacy>,
    ): Promise<TopicLegacy[]> {
        return this.topicFacadeService.find();
    }

    // ── Publish workflow — registered BEFORE /{id} ────────────────────────────

    /**
     * GET /topics/to-production?id=n
     *
     * Promotes the APPROVED revision to PUBLISHED.
     * Must be registered before /{id} to prevent router matching
     * "to-production" as a numeric id.
     */
    @get('/topics/to-production', {
        responses: {
            '200': { description: 'Topic published to production' },
        },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[TopicsController.publish]', { id });
        await this.topicFacadeService.publish(id);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    /**
     * GET /topics/:id
     *
     * Returns TopicFull with ALL per-language translations, parentId, depth,
     * and version history. One round-trip — the PA form needs no second call.
     */
    @get('/topics/{id}', {
        responses: {
            '200': {
                description: 'Topic with all translations (form context)',
                content: {
                    'application/json': { schema: getModelSchemaRef(TopicFull) },
                },
            },
        },
    })
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    async findById(
        @param.path.number('id') id: number,
        @param.filter(TopicFull, { exclude: 'where' })
        _filter?: FilterExcludingWhere<TopicFull>,
    ): Promise<TopicFull> {
        this.logger.info('[TopicsController.findById]', { id });
        return this.topicFacadeService.findById(id);
    }

    // ── Full replace ──────────────────────────────────────────────────────────

    /**
     * PUT /topics/:id
     *
     * Replaces the full topic: metadata (dataExtra) + all translations + parent.
     * Used by the PA form Save button.
     */
    @put('/topics/{id}', {
        responses: { '204': { description: 'Topic updated (full replace)' } },
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
                            parentId: { type: 'number', nullable: true },
                            translations: TRANSLATIONS_MAP_SCHEMA,
                        },
                    },
                },
            },
        })
        body: TopicFull,
    ): Promise<void> {
        this.logger.info('[TopicsController.replaceById]', {
            id,
            status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
            parentId: body.parentId,
        });
        await this.topicFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    /**
     * PATCH /topics/:id
     *
     * Partial update — status toggle, icon change, parentId change.
     * Does NOT touch translations unless topic/description are included.
     */
    @patch('/topics/{id}', {
        responses: { '204': { description: 'Topic partial update' } },
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
                            topic: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                            parentId: { type: 'number', nullable: true },
                        },
                    },
                },
            },
        })
        body: Partial<TopicLegacy>,
    ): Promise<void> {
        this.logger.info('[TopicsController.updateById]', {
            id,
            fields: Object.keys(body),
        });
        await this.topicFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    /**
     * DELETE /topics/:id
     *
     * Deletes the topic. Will return 409 Conflict if the topic still has
     * children — the client must reassign or delete them first.
     */
    @del('/topics/{id}', {
        responses: {
            '204': { description: 'Topic deleted' },
            '409': { description: 'Cannot delete: topic has children' },
        },
    })
    @authorize({ allowedRoles: ['pa_admin'] })
    async deleteById(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn('[TopicsController.deleteById]', { id });
        await this.topicFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    /**
     * GET /topics-migrant
     *
     * Returns PUBLISHED topics resolved to the best available language.
     * Includes `father` (legacy field name = parentId) for tree reconstruction
     * on the migrant app side.
     *
     * @authenticate.skip() — public endpoint, no auth token required.
     */
    @authenticate.skip()
    @get('/topics-migrant', {
        responses: {
            '200': {
                description: 'Published topics for migrant frontend (lang-resolved)',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    topic: { type: 'string' },
                                    description: { type: 'string' },
                                    lang: { type: 'string' },
                                    icon: { type: 'string' },
                                    father: { type: 'number', nullable: true },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async translatedTopics(
        @param.query.string('defaultlang') defaultlang = 'it',
        @param.query.string('currentlang') currentlang = 'it',
    ): Promise<Array<Record<string, unknown>>> {
        return this.topicFacadeService.getTranslatedForFrontend(defaultlang, currentlang);
    }
}