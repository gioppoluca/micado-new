/**
 * src/controllers/ngo-process-comments.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /ngo/process-comments?processId=   List comments for a published process
 *   POST /ngo/process-comments              Create a comment
 *   PUT  /ngo/process-comments/{id}         Replace body + published flag
 *   DEL  /ngo/process-comments/{id}         Delete
 *
 * ── Authorization ─────────────────────────────────────────────────────────────
 *
 *   All endpoints: ngo_admin | ngo_operator
 *
 *   Group scoping is enforced in the service, not in the controller.
 *   The service reads the caller's group from the JWT (same mechanism as
 *   NgoUserManagementService.resolveCallerGroupId) and filters/scopes all
 *   queries accordingly.  The controller never receives or passes a groupId
 *   — callers cannot spoof another group's comments.
 *
 * ── Query by processId (externalKey) ─────────────────────────────────────────
 *
 *   The frontend passes the process externalKey (legacy integer id) as
 *   `processId`.  The service resolves the current published_revision_id from
 *   the content_item record and queries comments for that revision only.
 *   This means comments on older revisions are automatically excluded.
 */

import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { del, get, param, post, put, requestBody } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { NgoProcessCommentService } from '../services/ngo-process-comment.service';

// ── Response schema ───────────────────────────────────────────────────────────

const COMMENT_SCHEMA = {
    type: 'object' as const,
    required: ['id', 'revisionId', 'ngoGroupId', 'body', 'published'],
    properties: {
        id:          { type: 'string' },
        revisionId:  { type: 'string' },
        ngoGroupId:  { type: 'string' },
        body:        { type: 'string' },
        published:   { type: 'boolean' },
        createdAt:   { type: 'string' },
        updatedAt:   { type: 'string' },
        createdBy: {
            type: 'object',
            properties: {
                sub:      { type: 'string' },
                username: { type: 'string' },
                name:     { type: 'string' },
                realm:    { type: 'string' },
            },
        },
    },
};

@authenticate('keycloak')
@authorize({ allowedRoles: ['ngo_admin', 'ngo_operator', 'ngo-admin'] })
export class NgoProcessCommentsController {
    constructor(
        @inject('services.NgoProcessCommentService')
        private readonly commentService: NgoProcessCommentService,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    /**
     * GET /ngo/process-comments?processId=<externalKey>
     *
     * Returns all comments written by the caller's NGO group for the currently
     * published revision of the given process.
     * Comments on older revisions are automatically excluded.
     */
    @get('/ngo/process-comments', {
        responses: {
            '200': {
                description: 'Comments by this NGO group for the current published revision.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: COMMENT_SCHEMA },
                    },
                },
            },
        },
    })
    async list(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.query.number('processId') processId: number,
    ): Promise<object[]> {
        this.logger.info('[NgoProcessCommentsController] list', {
            caller: caller.id, processId,
        });
        return this.commentService.listForProcess(caller, processId);
    }

    /**
     * POST /ngo/process-comments
     *
     * Create a new comment on the current published revision of the process.
     * The revisionId is resolved server-side from processId — the client never
     * supplies it directly.
     */
    @post('/ngo/process-comments', {
        responses: {
            '200': {
                description: 'Created comment.',
                content: { 'application/json': { schema: COMMENT_SCHEMA } },
            },
        },
    })
    async create(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['processId', 'body'],
                        properties: {
                            processId: { type: 'number', description: 'Process externalKey (legacy integer id)' },
                            body:      { type: 'string', minLength: 1 },
                            published: { type: 'boolean' },
                        },
                    },
                },
            },
        })
        body: { processId: number; body: string; published?: boolean },
    ): Promise<object> {
        this.logger.info('[NgoProcessCommentsController] create', {
            caller: caller.id, processId: body.processId,
        });
        return this.commentService.create(caller, body.processId, body.body, body.published ?? false);
    }

    /**
     * PUT /ngo/process-comments/{id}
     *
     * Replace body text and/or published flag.
     * The service verifies the comment belongs to the caller's group.
     */
    @put('/ngo/process-comments/{id}', {
        responses: {
            '200': {
                description: 'Updated comment.',
                content: { 'application/json': { schema: COMMENT_SCHEMA } },
            },
        },
    })
    async replace(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['body'],
                        properties: {
                            body:      { type: 'string', minLength: 1 },
                            published: { type: 'boolean' },
                        },
                    },
                },
            },
        })
        body: { body: string; published?: boolean },
    ): Promise<object> {
        this.logger.info('[NgoProcessCommentsController] replace', {
            caller: caller.id, id,
        });
        return this.commentService.update(caller, id, body.body, body.published);
    }

    /**
     * DEL /ngo/process-comments/{id}
     *
     * Delete a comment. Only allowed if it belongs to the caller's group.
     */
    @del('/ngo/process-comments/{id}', {
        responses: {
            '204': { description: 'Comment deleted.' },
        },
    })
    async remove(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
    ): Promise<void> {
        this.logger.warn('[NgoProcessCommentsController] remove', {
            caller: caller.id, id,
        });
        return this.commentService.delete(caller, id);
    }
}
