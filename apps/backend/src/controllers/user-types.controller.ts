/**
 * src/controllers/user-types.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /user-types              list — UserTypeLegacy[] (lean, sourceLang only)
 *   GET  /user-types/count        count
 *   POST /user-types              create — flat fields + optional translations map
 *   GET  /user-types/:id          single — UserTypeFull (all translations embedded)
 *   PUT  /user-types/:id          full replace — UserTypeFull shape, 204
 *   PATCH /user-types/:id         partial update (status toggle, icon), 204
 *   DELETE /user-types/:id        delete, 204
 *   GET  /user-types-migrant      migrant frontend — published, lang-resolved, flat
 *   GET  /user-types/to-production?id=n  publish workflow
 *
 * ── Why write endpoints use inline schemas instead of getModelSchemaRef ────────
 *
 *   getModelSchemaRef() emits a JSON Schema $ref pointing to the model definition.
 *   LoopBack's AJV validator resolves that $ref at runtime, and the resolved schema
 *   does NOT have `additionalProperties: true` — AJV therefore rejects any property
 *   not explicitly declared on the @model class.
 *
 *   Concrete failures:
 *     POST: `translations` is not a @property on UserTypeLegacy → rejected.
 *     PUT:  AJV resolves UserTypeFull.$ref → translation entry objects are
 *           validated strictly → any unlisted field (e.g. tStatus) is rejected.
 *
 *   Fix: define request body schemas fully inline for POST, PUT, and PATCH.
 *   No $ref is generated, AJV sees exactly what we write, and we control
 *   additionalProperties explicitly.
 *
 *   Read endpoint responses still use getModelSchemaRef — AJV does not validate
 *   response bodies, so $ref resolution is safe there and gives free OpenAPI docs.
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
import { UserTypeLegacy } from '../models';
import { UserTypeFull } from '../models/user-type-full.model';
import { UserTypeFacadeService } from '../services/user-type-facade.service';

// ─── Reusable inline schema fragments ─────────────────────────────────────────
// Defined once so POST and PUT stay in sync.
//
// Typed as SchemaObject (not `as const`) because SchemaObject.enum expects
// `any[]` (mutable) — `as const` produces readonly tuples that are not
// assignable to the mutable type, causing TS2322.

/** Per-language translation entry — additionalProperties:true for forward compat. */
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

/** Map of lang code → TranslationEntry. */
const TRANSLATIONS_MAP_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: TRANSLATION_ENTRY_SCHEMA,
};

/** Opaque extra-data bag. */
const DATA_EXTRA_SCHEMA: SchemaObject = {
    type: 'object',
    additionalProperties: true,
};

/** Status enum shared by all write schemas. */
const STATUS_SCHEMA: SchemaObject = {
    type: 'string',
    enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
};

@authenticate('keycloak')
export class UserTypesController {
    constructor(
        @service(UserTypeFacadeService)
        protected userTypeFacadeService: UserTypeFacadeService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * POST /user-types
     *
     * Creates a new user type.  The optional `translations` map allows the PA
     * form to persist all language content in a single POST — no follow-up PUT
     * needed for new records.
     *
     * Schema is inline to prevent AJV from rejecting `translations` via the
     * implicit additionalProperties:false that comes from a $ref-based schema.
     */
    @post('/user-types', {
        responses: {
            '200': {
                description: 'Created UserType (flat, sourceLang only)',
                content: { 'application/json': { schema: getModelSchemaRef(UserTypeLegacy) } },
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
                            user_type: { type: 'string' },
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
        body: Omit<UserTypeLegacy, 'id' | 'status'> & {
            translations?: Record<string, { title: string; description?: string }>;
        },
    ): Promise<UserTypeLegacy> {
        this.logger.info('[UserTypesController.create]', { user_type: body.user_type });
        return this.userTypeFacadeService.create(body);
    }

    // ── Count ─────────────────────────────────────────────────────────────────

    @get('/user-types/count', {
        responses: {
            '200': {
                description: 'UserType count',
                content: { 'application/json': { schema: CountSchema } },
            },
        },
    })
    async count(
        @param.where(UserTypeLegacy) where?: Where<UserTypeLegacy>,
    ): Promise<{ count: number }> {
        return this.userTypeFacadeService.count(where as Record<string, unknown>);
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @get('/user-types', {
        responses: {
            '200': {
                description: 'Array of UserType (flat, sourceLang only)',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: getModelSchemaRef(UserTypeLegacy) },
                    },
                },
            },
        },
    })
    async find(
        @param.filter(UserTypeLegacy) filter?: Filter<UserTypeLegacy>,
    ): Promise<UserTypeLegacy[]> {
        return this.userTypeFacadeService.find(filter);
    }

    // ── Single item (rich) ────────────────────────────────────────────────────

    /**
     * GET /user-types/:id
     *
     * Returns UserTypeFull with ALL per-language translations embedded.
     * One round-trip — the PA form needs no second call.
     */
    @get('/user-types/{id}', {
        responses: {
            '200': {
                description: 'UserType with all translations (form context)',
                content: {
                    'application/json': {
                        schema: getModelSchemaRef(UserTypeFull),
                    },
                },
            },
        },
    })
    async findById(
        @param.path.number('id') id: number,
        @param.filter(UserTypeFull, { exclude: 'where' })
        _filter?: FilterExcludingWhere<UserTypeFull>,
    ): Promise<UserTypeFull> {
        this.logger.info('[UserTypesController.findById]', { id });
        return this.userTypeFacadeService.findById(id);
    }

    // ── Full replace (form save) ──────────────────────────────────────────────

    /**
     * PUT /user-types/:id
     *
     * Replaces the full user type: metadata + all translations in one call.
     * Used by the PA form Save button.
     *
     * Languages absent from body.translations are NOT deleted — the server only
     * upserts.  Concurrent translator work on other languages is preserved.
     *
     * Schema is inline — see module-level comment on why getModelSchemaRef
     * cannot be used for write endpoints.
     */
    @put('/user-types/{id}', {
        responses: { '204': { description: 'UserType updated (full replace)' } },
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
        body: UserTypeFull,
    ): Promise<void> {
        this.logger.info('[UserTypesController.replaceById]', {
            id,
            status: body.status,
            langCount: Object.keys(body.translations ?? {}).length,
        });
        await this.userTypeFacadeService.replaceById(id, body);
    }

    // ── Partial update ────────────────────────────────────────────────────────

    /**
     * PATCH /user-types/:id
     *
     * Partial update — status toggle from list row, icon change, or other
     * single-field patches.  Does NOT touch translations.
     */
    @patch('/user-types/{id}', {
        responses: { '204': { description: 'UserType partial update' } },
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
                            user_type: { type: 'string' },
                            description: { type: 'string' },
                            status: STATUS_SCHEMA,
                            sourceLang: { type: 'string' },
                            dataExtra: DATA_EXTRA_SCHEMA,
                        },
                    },
                },
            },
        })
        body: Partial<UserTypeLegacy>,
    ): Promise<void> {
        this.logger.info('[UserTypesController.updateById]', {
            id,
            fields: Object.keys(body),
        });
        await this.userTypeFacadeService.updateById(id, body);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @del('/user-types/{id}', {
        responses: { '204': { description: 'UserType deleted' } },
    })
    async deleteById(
        @param.path.number('id') id: number,
    ): Promise<void> {
        this.logger.warn('[UserTypesController.deleteById]', { id });
        await this.userTypeFacadeService.deleteById(id);
    }

    // ── Migrant frontend ──────────────────────────────────────────────────────

    @get('/user-types-migrant', {
        responses: {
            '200': {
                description: 'Published user types for migrant frontend (lang-resolved)',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    user_type: { type: 'string' },
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
    async translatedunion(
        @param.query.string('defaultlang') defaultlang = 'en',
        @param.query.string('currentlang') currentlang = 'en',
    ): Promise<Array<Record<string, unknown>>> {
        return this.userTypeFacadeService.getTranslatedForFrontend(
            defaultlang,
            currentlang,
        );
    }

    // ── Publish workflow ──────────────────────────────────────────────────────

    /**
     * GET /user-types/to-production?id=n
     *
     * Promotes the APPROVED revision to PUBLISHED.
     * Registered before /{id} to prevent route collision with the literal
     * path segment "to-production" being matched as a numeric id.
     */
    @get('/user-types/to-production', {
        responses: { '200': { description: 'UserType published to production' } },
    })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        this.logger.info('[UserTypesController.publish]', { id });
        await this.userTypeFacadeService.publish(id);
    }
}