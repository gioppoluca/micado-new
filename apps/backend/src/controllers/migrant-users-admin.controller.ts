/**
 * src/controllers/migrant-users-admin.controller.ts
 *
 * REST endpoints for PA operators to manage migrant accounts.
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 *
 *   GET  /admin/migrants/users            pa_admin | pa_operator | pa_viewer
 *   GET  /admin/migrants/users/:id        pa_admin | pa_operator | pa_viewer
 *   DEL  /admin/migrants/users/:id        pa_admin
 *   GET  /admin/migrants/users/:id/notes  pa_admin | pa_operator | pa_viewer
 *   PATCH /admin/migrants/users/:id/notes pa_admin | pa_operator
 *
 * Notes are stored in migrant_profile.notes via InterventionPlanService
 * (which owns the MigrantProfileRepository) to avoid splitting concerns.
 *
 * Migrants self-register via the migrants app — there is intentionally no
 * POST /admin/migrants/users endpoint here.
 */

import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject, service } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { del, get, param, patch, requestBody } from '@loopback/rest';
import {
    MigrantUserManagementService,
    MigrantUserSummaryDto,
} from '../services/migrant-user-management.service';
import { InterventionPlanService } from '../services/intervention-plan.service';

const MIGRANT_USER_RESPONSE_SCHEMA = {
    type: 'object',
    required: ['id'],
    properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string' },
        email: { type: 'string', format: 'email' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        enabled: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
        createdTimestamp: {
            type: 'number',
            description: 'Epoch milliseconds — when the migrant registered in Keycloak.',
        },
    },
};

@authenticate('keycloak')
export class MigrantUsersAdminController {
    constructor(
        @inject('services.MigrantUserManagementService')
        private readonly migrantUserService: MigrantUserManagementService,
        @service(InterventionPlanService)
        private readonly planService: InterventionPlanService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    // ── List ────────────────────────────────────────────────────────────────────

    /**
     * GET /admin/migrants/users
     *
     * Returns all migrant users from the Keycloak migrants realm.
     * Accessible by pa_admin, pa_operator, and pa_viewer.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    @get('/admin/migrants/users', {
        responses: {
            '200': {
                description: 'Migrant users from the Keycloak migrants realm.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: MIGRANT_USER_RESPONSE_SCHEMA },
                    },
                },
            },
        },
    })
    async listUsers(): Promise<MigrantUserSummaryDto[]> {
        this.logger.info('[MigrantUsersAdminController.listUsers]');
        return this.migrantUserService.listUsers();
    }

    // ── Get single ──────────────────────────────────────────────────────────────

    /**
     * GET /admin/migrants/users/:id
     *
     * Retrieves a single migrant user by Keycloak UUID.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    @get('/admin/migrants/users/{id}', {
        responses: {
            '200': {
                description: 'A single migrant user.',
                content: { 'application/json': { schema: MIGRANT_USER_RESPONSE_SCHEMA } },
            },
            '404': { description: 'User not found in migrants realm.' },
        },
    })
    async getUser(
        @param.path.string('id') id: string,
    ): Promise<MigrantUserSummaryDto> {
        this.logger.info('[MigrantUsersAdminController.getUser]', { id });
        return this.migrantUserService.getUserById(id);
    }

    // ── Notes ───────────────────────────────────────────────────────────────────

    /**
     * GET /admin/migrants/users/:id/notes
     *
     * Returns PA internal notes for a migrant.
     * Returns { notes: null } when the migrant_profile row does not yet exist.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'pa_viewer'] })
    @get('/admin/migrants/users/{id}/notes', {
        responses: {
            '200': {
                description: 'PA internal notes for a migrant.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: { notes: { type: 'string', nullable: true } },
                        },
                    },
                },
            },
        },
    })
    async getNotes(
        @param.path.string('id') id: string,
    ): Promise<{ notes: string | null }> {
        this.logger.info('[MigrantUsersAdminController.getNotes]', { id });
        const notes = await this.planService.getNotes(id);
        return { notes };
    }

    /**
     * PATCH /admin/migrants/users/:id/notes
     *
     * Upserts PA internal notes. Creates migrant_profile lazily if needed.
     */
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @patch('/admin/migrants/users/{id}/notes', {
        responses: {
            '200': {
                description: 'Saved notes.',
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { notes: { type: 'string' } } },
                    },
                },
            },
        },
    })
    async updateNotes(
        @param.path.string('id') id: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['notes'],
                        properties: { notes: { type: 'string' } },
                    },
                },
            },
        })
        body: { notes: string },
    ): Promise<{ notes: string }> {
        this.logger.info('[MigrantUsersAdminController.updateNotes]', { id });
        const saved = await this.planService.updateNotes(id, body.notes);
        return { notes: saved };
    }

    // ── Delete ──────────────────────────────────────────────────────────────────

    /**
     * DELETE /admin/migrants/users/:id
     *
     * Hard-deletes the migrant account from Keycloak.
     * Restricted to pa_admin — irreversible.
     * The migrant_profile row is preserved for audit.
     */
    @authorize({ allowedRoles: ['pa_admin'] })
    @del('/admin/migrants/users/{id}', {
        responses: {
            '204': { description: 'Migrant user deleted from Keycloak.' },
            '404': { description: 'User not found in migrants realm.' },
        },
    })
    async deleteUser(
        @param.path.string('id') id: string,
    ): Promise<void> {
        this.logger.warn('[MigrantUsersAdminController.deleteUser]', { id });
        await this.migrantUserService.deleteUser(id);
    }
}