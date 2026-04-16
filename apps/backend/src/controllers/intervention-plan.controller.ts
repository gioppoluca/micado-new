/**
 * src/controllers/intervention-plan.controller.ts
 *
 * REST endpoints for managing Individual Intervention Plans.
 *
 * ── Resource hierarchy ───────────────────────────────────────────────────────
 *
 *   /admin/migrants/:migrantId/plans              Plans scoped to a migrant
 *   /admin/migrants/:migrantId/plans/:planId      Single plan (with items)
 *   /admin/migrants/:migrantId/plans/:planId/items   Items within a plan
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 *
 *   GET    (read)       pa_admin | pa_operator | pa_viewer
 *   POST   (create)     pa_admin | pa_operator
 *   PATCH  (update)     pa_admin | pa_operator
 *   DELETE              pa_admin
 *
 *   Rationale: a social assistant (pa_operator) creates and edits plans at the
 *   desk. pa_viewer can observe but not modify. Delete is restricted to pa_admin
 *   because removing a plan is a high-impact action.
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *
 *   These are operational tables — NOT part of the CRT content model.
 *   No revision / translation cycle applies.
 *   intervention_type_id is an optional FK to content_item (type=INTERVENTION_TYPE)
 *   for catalogue-driven items. Ad-hoc items carry only a free-text title.
 */

import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { del, get, param, patch, post, requestBody } from '@loopback/rest';
import {
    InterventionPlanService,
    CreateInterventionPlanInput,
    UpdateInterventionPlanInput,
    CreateInterventionPlanItemInput,
    UpdateInterventionPlanItemInput,
} from '../services/intervention-plan.service';
import { InterventionPlan, InterventionPlanItem } from '../models';
import { buildActorStamp } from '../auth/actor-stamp';

// ── OpenAPI inline schemas ────────────────────────────────────────────────────

const PLAN_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        migrantId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        caseManager: { type: 'string' },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        completed: { type: 'boolean' },
        notes: { type: 'string' },
        createdBy: { type: 'object' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        items: { type: 'array' },
    },
};

const ITEM_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        planId: { type: 'string', format: 'uuid' },
        interventionTypeId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        description: { type: 'string' },
        assignedDate: { type: 'string', format: 'date' },
        dueDate: { type: 'string', format: 'date' },
        completed: { type: 'boolean' },
        completedDate: { type: 'string', format: 'date' },
        validationRequestedAt: { type: 'string', format: 'date-time' },
        validatedBy: { type: 'object' },
        validatedAt: { type: 'string', format: 'date-time' },
        sortOrder: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

@authenticate('keycloak')
export class InterventionPlanController {
    constructor(
        @service(InterventionPlanService)
        private readonly planService: InterventionPlanService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
        @inject(SecurityBindings.USER, { optional: true })
        private readonly currentUser: UserProfile | undefined,
    ) { }

    // ── Plans ──────────────────────────────────────────────────────────────────

    /**
     * GET /admin/migrants/:migrantId/plans
     *
     * Lists all intervention plans for a migrant, ordered by creation date desc.
     * Does NOT include items (lightweight list view).
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    @get('/admin/migrants/{migrantId}/plans', {
        responses: {
            '200': {
                description: 'Intervention plans for a migrant.',
                content: {
                    'application/json': { schema: { type: 'array', items: PLAN_SCHEMA } },
                },
            },
        },
    })
    async listPlans(
        @param.path.string('migrantId') migrantId: string,
    ): Promise<InterventionPlan[]> {
        this.logger.info('[InterventionPlanController.listPlans]', { migrantId });
        return this.planService.listPlans(migrantId);
    }

    /**
     * GET /admin/migrants/:migrantId/plans/:planId
     *
     * Returns a single plan with all its items eagerly loaded.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    @get('/admin/migrants/{migrantId}/plans/{planId}', {
        responses: {
            '200': {
                description: 'A single intervention plan with its items.',
                content: { 'application/json': { schema: PLAN_SCHEMA } },
            },
            '404': { description: 'Plan not found.' },
        },
    })
    async getPlan(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') planId: string,
    ): Promise<InterventionPlan> {
        this.logger.info('[InterventionPlanController.getPlan]', { planId });
        return this.planService.getPlanById(planId);
    }

    /**
     * POST /admin/migrants/:migrantId/plans
     *
     * Creates a new intervention plan for the migrant.
     * The PA operator who creates it is recorded in created_by (ActorStamp).
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @post('/admin/migrants/{migrantId}/plans', {
        responses: {
            '200': {
                description: 'Created intervention plan.',
                content: { 'application/json': { schema: PLAN_SCHEMA } },
            },
        },
    })
    async createPlan(
        @param.path.string('migrantId') migrantId: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            caseManager: { type: 'string' },
                            startDate: { type: 'string', format: 'date' },
                            endDate: { type: 'string', format: 'date' },
                            notes: { type: 'string' },
                        },
                    },
                },
            },
        })
        body: Omit<CreateInterventionPlanInput, 'migrantId'>,
    ): Promise<InterventionPlan> {
        const actor = buildActorStamp(this.currentUser);
        this.logger.info('[InterventionPlanController.createPlan]', {
            migrantId,
            actor: actor?.sub,
        });
        return this.planService.createPlan({ ...body, migrantId }, actor);
    }

    /**
     * PATCH /admin/migrants/:migrantId/plans/:planId
     *
     * Partial update of a plan (title, dates, case manager, completion, notes).
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @patch('/admin/migrants/{migrantId}/plans/{planId}', {
        responses: {
            '200': {
                description: 'Updated intervention plan.',
                content: { 'application/json': { schema: PLAN_SCHEMA } },
            },
            '404': { description: 'Plan not found.' },
        },
    })
    async updatePlan(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') planId: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            caseManager: { type: 'string' },
                            startDate: { type: 'string', format: 'date' },
                            endDate: { type: 'string', format: 'date' },
                            completed: { type: 'boolean' },
                            notes: { type: 'string' },
                        },
                    },
                },
            },
        })
        body: UpdateInterventionPlanInput,
    ): Promise<InterventionPlan> {
        this.logger.info('[InterventionPlanController.updatePlan]', { planId });
        return this.planService.updatePlan(planId, body);
    }

    /**
     * DELETE /admin/migrants/:migrantId/plans/:planId
     *
     * Deletes a plan and all its items (CASCADE).
     * Restricted to pa_admin — irreversible operation.
     */
    @authorize({ allowedRoles: ['pa_admin'] })
    @del('/admin/migrants/{migrantId}/plans/{planId}', {
        responses: {
            '204': { description: 'Plan deleted.' },
            '404': { description: 'Plan not found.' },
        },
    })
    async deletePlan(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') planId: string,
    ): Promise<void> {
        this.logger.warn('[InterventionPlanController.deletePlan]', { planId });
        await this.planService.deletePlan(planId);
    }

    // ── Plan Items ─────────────────────────────────────────────────────────────

    /**
     * POST /admin/migrants/:migrantId/plans/:planId/items
     *
     * Adds a new item to a plan.
     * intervention_type_id is optional — omit for ad-hoc items.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @post('/admin/migrants/{migrantId}/plans/{planId}/items', {
        responses: {
            '200': {
                description: 'Created plan item.',
                content: { 'application/json': { schema: ITEM_SCHEMA } },
            },
        },
    })
    async createItem(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') planId: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            interventionTypeId: { type: 'string', format: 'uuid' },
                            title: { type: 'string' },
                            description: { type: 'string' },
                            assignedDate: { type: 'string', format: 'date' },
                            dueDate: { type: 'string', format: 'date' },
                            sortOrder: { type: 'integer' },
                        },
                    },
                },
            },
        })
        body: CreateInterventionPlanItemInput,
    ): Promise<InterventionPlanItem> {
        this.logger.info('[InterventionPlanController.createItem]', { planId });
        return this.planService.createPlanItem(planId, body);
    }

    /**
     * PATCH /admin/migrants/:migrantId/plans/:planId/items/:itemId
     *
     * Partial update of a plan item.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @patch('/admin/migrants/{migrantId}/plans/{planId}/items/{itemId}', {
        responses: {
            '200': {
                description: 'Updated plan item.',
                content: { 'application/json': { schema: ITEM_SCHEMA } },
            },
            '404': { description: 'Item not found.' },
        },
    })
    async updateItem(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') _planId: string,
        @param.path.string('itemId') itemId: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            description: { type: 'string' },
                            assignedDate: { type: 'string', format: 'date' },
                            dueDate: { type: 'string', format: 'date' },
                            completed: { type: 'boolean' },
                            completedDate: { type: 'string', format: 'date' },
                            sortOrder: { type: 'integer' },
                        },
                    },
                },
            },
        })
        body: UpdateInterventionPlanItemInput,
    ): Promise<InterventionPlanItem> {
        this.logger.info('[InterventionPlanController.updateItem]', { itemId });
        return this.planService.updatePlanItem(itemId, body);
    }

    /**
     * POST /admin/migrants/:migrantId/plans/:planId/items/:itemId/request-validation
     *
     * Marks a plan item as "awaiting NGO validation".
     * Sets validation_requested_at if not already set (idempotent).
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @post(
        '/admin/migrants/{migrantId}/plans/{planId}/items/{itemId}/request-validation',
        {
            responses: {
                '200': {
                    description: 'Item updated — validation requested.',
                    content: { 'application/json': { schema: ITEM_SCHEMA } },
                },
            },
        },
    )
    async requestValidation(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') _planId: string,
        @param.path.string('itemId') itemId: string,
    ): Promise<InterventionPlanItem> {
        this.logger.info('[InterventionPlanController.requestValidation]', {
            itemId,
        });
        return this.planService.requestItemValidation(itemId);
    }

    /**
     * DELETE /admin/migrants/:migrantId/plans/:planId/items/:itemId
     *
     * Removes a single item from the plan.
     * Restricted to pa_admin.
     */
    @authorize({ allowedRoles: ['pa_admin'] })
    @del('/admin/migrants/{migrantId}/plans/{planId}/items/{itemId}', {
        responses: {
            '204': { description: 'Item deleted.' },
            '404': { description: 'Item not found.' },
        },
    })
    async deleteItem(
        @param.path.string('migrantId') _migrantId: string,
        @param.path.string('planId') _planId: string,
        @param.path.string('itemId') itemId: string,
    ): Promise<void> {
        this.logger.warn('[InterventionPlanController.deleteItem]', { itemId });
        await this.planService.deletePlanItem(itemId);
    }
}