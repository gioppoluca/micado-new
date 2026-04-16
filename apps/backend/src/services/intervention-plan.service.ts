/**
 * src/services/intervention-plan.service.ts
 *
 * Business logic for Individual Integration Plans.
 * Uses LoopBack 4 repositories — NOT raw SQL.
 */

import { inject, injectable, BindingScope } from '@loopback/core';
import { repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { WinstonLogger, LoggingBindings } from '@loopback/logging';
import {
    MigrantProfile,
    InterventionPlan,
    InterventionPlanItem,
} from '../models';
import {
    MigrantProfileRepository,
    InterventionPlanRepository,
    InterventionPlanItemRepository,
} from '../repositories';
import type { ActorStamp } from '../auth/actor-stamp';

export interface CreateInterventionPlanInput {
    migrantId: string;
    title?: string;
    caseManager?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
}

export interface UpdateInterventionPlanInput {
    title?: string;
    caseManager?: string;
    startDate?: string;
    endDate?: string;
    completed?: boolean;
    notes?: string;
}

export interface CreateInterventionPlanItemInput {
    interventionTypeId?: string;
    title?: string;
    description?: string;
    assignedDate?: string;
    dueDate?: string;
    sortOrder?: number;
}

export interface UpdateInterventionPlanItemInput {
    title?: string;
    description?: string;
    assignedDate?: string;
    dueDate?: string;
    completed?: boolean;
    completedDate?: string;
    sortOrder?: number;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class InterventionPlanService {
    constructor(
        @repository(MigrantProfileRepository)
        protected migrantProfileRepository: MigrantProfileRepository,

        @repository(InterventionPlanRepository)
        protected interventionPlanRepository: InterventionPlanRepository,

        @repository(InterventionPlanItemRepository)
        protected interventionPlanItemRepository: InterventionPlanItemRepository,

        @inject(LoggingBindings.WINSTON_LOGGER)
        protected logger: WinstonLogger,
    ) { }

    // ── Notes ────────────────────────────────────────────────────────────────

    async getNotes(migrantId: string): Promise<string | null> {
        const profile = await this.migrantProfileRepository.findOne({
            where: { keycloakId: migrantId },
            fields: { notes: true, keycloakId: true },
        });
        return profile?.notes ?? null;
    }

    async updateNotes(migrantId: string, notes: string): Promise<string> {
        const existing = await this.migrantProfileRepository.findOne({
            where: { keycloakId: migrantId },
        });

        if (existing) {
            await this.migrantProfileRepository.updateById(migrantId, {
                notes,
                updatedAt: new Date().toISOString(),
            });
        } else {
            await this.migrantProfileRepository.create(
                Object.assign(new MigrantProfile(), {
                    keycloakId: migrantId,
                    realm: 'migrants',
                    notes,
                }),
            );
        }

        this.logger.info('[InterventionPlanService.updateNotes]', {
            migrantId,
            notesLength: notes.length,
        });

        return notes;
    }

    // ── Plans ────────────────────────────────────────────────────────────────

    async listPlans(migrantId: string): Promise<InterventionPlan[]> {
        const plans = await this.interventionPlanRepository.find({
            where: { migrantId },
            order: ['createdAt DESC'],
        });

        this.logger.info('[InterventionPlanService.listPlans]', {
            migrantId,
            count: plans.length,
        });

        return plans;
    }

    async getPlanById(planId: string): Promise<InterventionPlan> {
        const plan = await this.interventionPlanRepository.findOne({
            where: { id: planId },
            include: [{
                relation: 'items',
                scope: { order: ['sortOrder ASC', 'createdAt ASC'] },
            }],
        });

        if (!plan) {
            throw new HttpErrors.NotFound(`Intervention plan ${planId} not found.`);
        }

        return plan;
    }

    async createPlan(
        input: CreateInterventionPlanInput,
        actor: ActorStamp | undefined,
    ): Promise<InterventionPlan> {
        await this.ensureMigrantProfile(input.migrantId);

        const plan = await this.interventionPlanRepository.create(
            Object.assign(new InterventionPlan(), {
                migrantId: input.migrantId,
                title: input.title,
                caseManager: input.caseManager,
                startDate: input.startDate,
                endDate: input.endDate,
                notes: input.notes,
                completed: false,
                ...(actor && { createdBy: actor }),
            }),
        );

        this.logger.info('[InterventionPlanService.createPlan]', {
            planId: plan.id,
            migrantId: input.migrantId,
            actor: actor?.sub,
        });

        return Object.assign(plan, { items: [] });
    }

    async updatePlan(
        planId: string,
        input: UpdateInterventionPlanInput,
    ): Promise<InterventionPlan> {
        await this.assertPlanExists(planId);

        const patch: Partial<InterventionPlan> = {
            updatedAt: new Date().toISOString(),
        };
        if (input.title !== undefined) patch.title = input.title;
        if (input.caseManager !== undefined) patch.caseManager = input.caseManager;
        if (input.startDate !== undefined) patch.startDate = input.startDate;
        if (input.endDate !== undefined) patch.endDate = input.endDate;
        if (input.completed !== undefined) patch.completed = input.completed;
        if (input.notes !== undefined) patch.notes = input.notes;

        await this.interventionPlanRepository.updateById(planId, patch);

        this.logger.info('[InterventionPlanService.updatePlan]', { planId });

        return this.getPlanById(planId);
    }

    async deletePlan(planId: string): Promise<void> {
        await this.assertPlanExists(planId);
        await this.interventionPlanRepository.deleteById(planId);

        this.logger.warn('[InterventionPlanService.deletePlan]', { planId });
    }

    // ── Items ────────────────────────────────────────────────────────────────

    async createPlanItem(
        planId: string,
        input: CreateInterventionPlanItemInput,
    ): Promise<InterventionPlanItem> {
        await this.assertPlanExists(planId);

        const item = await this.interventionPlanItemRepository.create(
            Object.assign(new InterventionPlanItem(), {
                planId,
                interventionTypeId: input.interventionTypeId,
                title: input.title,
                description: input.description,
                assignedDate: input.assignedDate,
                dueDate: input.dueDate,
                sortOrder: input.sortOrder ?? 0,
                completed: false,
            }),
        );

        this.logger.info('[InterventionPlanService.createPlanItem]', {
            planId,
            itemId: item.id,
        });

        return item;
    }

    async updatePlanItem(
        itemId: string,
        input: UpdateInterventionPlanItemInput,
    ): Promise<InterventionPlanItem> {
        await this.assertItemExists(itemId);

        const patch: Partial<InterventionPlanItem> = {
            updatedAt: new Date().toISOString(),
        };
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.assignedDate !== undefined) patch.assignedDate = input.assignedDate;
        if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
        if (input.completed !== undefined) patch.completed = input.completed;
        if (input.completedDate !== undefined) patch.completedDate = input.completedDate;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        await this.interventionPlanItemRepository.updateById(itemId, patch);

        this.logger.info('[InterventionPlanService.updatePlanItem]', { itemId });

        return this.assertItemExists(itemId);
    }

    /**
     * Sets validationRequestedAt = NOW() if not already set (idempotent).
     * The NGO app queries items where validationRequestedAt IS NOT NULL
     * AND validatedAt IS NULL to find items pending validation.
     */
    async requestItemValidation(itemId: string): Promise<InterventionPlanItem> {
        const item = await this.assertItemExists(itemId);

        if (!item.validationRequestedAt) {
            await this.interventionPlanItemRepository.updateById(itemId, {
                validationRequestedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }

        this.logger.info('[InterventionPlanService.requestItemValidation]', {
            itemId,
            alreadyRequested: !!item.validationRequestedAt,
        });

        return this.assertItemExists(itemId);
    }

    async deletePlanItem(itemId: string): Promise<void> {
        await this.assertItemExists(itemId);
        await this.interventionPlanItemRepository.deleteById(itemId);

        this.logger.warn('[InterventionPlanService.deletePlanItem]', { itemId });
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /** Upserts the migrant_profile anchor row — called before any plan write. */
    private async ensureMigrantProfile(migrantId: string): Promise<void> {
        const exists = await this.migrantProfileRepository.findOne({
            where: { keycloakId: migrantId },
            fields: { keycloakId: true },
        });

        if (!exists) {
            await this.migrantProfileRepository.create(
                Object.assign(new MigrantProfile(), {
                    keycloakId: migrantId,
                    realm: 'migrants',
                }),
            );
            this.logger.info('[InterventionPlanService.ensureMigrantProfile] created', {
                migrantId,
            });
        }
    }

    private async assertPlanExists(planId: string): Promise<InterventionPlan> {
        const plan = await this.interventionPlanRepository.findOne({
            where: { id: planId },
        });
        if (!plan) {
            throw new HttpErrors.NotFound(`Intervention plan ${planId} not found.`);
        }
        return plan;
    }

    private async assertItemExists(itemId: string): Promise<InterventionPlanItem> {
        const item = await this.interventionPlanItemRepository.findOne({
            where: { id: itemId },
        });
        if (!item) {
            throw new HttpErrors.NotFound(`Intervention plan item ${itemId} not found.`);
        }
        return item;
    }
}