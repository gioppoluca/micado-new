/**
 * src/services/ngo-process-comment.service.ts
 *
 * Business logic for NGO process comments.
 *
 * Group UUID resolution is delegated to NgoGroupResolverService (shared helper)
 * so the same two-path logic (JWT groups claim → ngoGroupId attribute) is used
 * consistently, and the UUID stored in ngo_group_id is always the stable
 * Keycloak group UUID.
 *
 * Comments are linked to a specific content_revision UUID, not the item.
 * On create the service resolves published_revision_id from the process
 * content_item. When a new revision is published, old comments stop appearing
 * automatically — no deletion needed.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { v4 as uuidv4 } from 'uuid';
import { NgoProcessCommentRepository } from '../repositories/ngo-process-comment.repository';
import { ContentItemRepository } from '../repositories/content-item.repository';
import { NgoGroupResolverService } from './ngo-group-resolver.service';
import { buildActorStamp } from '../auth/actor-stamp';

export interface NgoProcessCommentDto {
    id: string;
    revisionId: string;
    ngoGroupId: string;
    body: string;
    published: boolean;
    createdBy?: { sub: string; username: string; name: string; realm: string };
    createdAt?: string;
    updatedAt?: string;
}

const PROCESS_CODE = 'PROCESS';

@injectable({ scope: BindingScope.TRANSIENT })
export class NgoProcessCommentService {
    constructor(
        @repository(NgoProcessCommentRepository)
        private readonly commentRepo: NgoProcessCommentRepository,
        @repository(ContentItemRepository)
        private readonly contentItemRepo: ContentItemRepository,
        @inject('services.NgoGroupResolverService')
        private readonly groupResolver: NgoGroupResolverService,
        @inject(SecurityBindings.USER, { optional: true })
        private readonly currentUser: UserProfile | undefined,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    async listForProcess(caller: UserProfile, processId: number): Promise<NgoProcessCommentDto[]> {
        const groupId = await this.groupResolver.resolve(caller);
        const revisionId = await this.resolvePublishedRevisionId(processId);
        const rows = await this.commentRepo.find({
            where: { revisionId, ngoGroupId: groupId },
            order: ['createdAt ASC'],
        });
        this.logger.info('[NgoProcessCommentService.listForProcess]', {
            processId, revisionId, groupId, count: rows.length,
        });
        return rows.map(r => this.toDto(r));
    }

    async create(caller: UserProfile, processId: number, body: string, published: boolean): Promise<NgoProcessCommentDto> {
        const groupId = await this.groupResolver.resolve(caller);
        const revisionId = await this.resolvePublishedRevisionId(processId);
        const stamp = buildActorStamp(this.currentUser);
        const created = await this.commentRepo.create({
            id: uuidv4(),
            revisionId,
            ngoGroupId: groupId,
            body: body.trim(),
            published,
            ...(stamp && { createdBy: stamp }),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        this.logger.info('[NgoProcessCommentService.create]', {
            id: created.id, processId, revisionId, groupId, published,
        });
        return this.toDto(created);
    }

    async update(caller: UserProfile, id: string, body: string, published?: boolean): Promise<NgoProcessCommentDto> {
        const groupId = await this.groupResolver.resolve(caller);
        const existing = await this.assertOwnership(id, groupId);
        const updatedAt = new Date().toISOString();
        await this.commentRepo.updateById(id, {
            body: body.trim(),
            ...(published !== undefined && { published }),
            updatedAt,
        });
        this.logger.info('[NgoProcessCommentService.update]', { id, groupId, published });
        return this.toDto({ ...existing, body: body.trim(), ...(published !== undefined && { published }), updatedAt });
    }

    async delete(caller: UserProfile, id: string): Promise<void> {
        const groupId = await this.groupResolver.resolve(caller);
        await this.assertOwnership(id, groupId);
        await this.commentRepo.deleteById(id);
        this.logger.warn('[NgoProcessCommentService.delete]', { id, groupId });
    }

    private async resolvePublishedRevisionId(processId: number): Promise<string> {
        const item = await this.contentItemRepo.findOne({
            where: { typeCode: PROCESS_CODE, externalKey: String(processId) },
        });
        if (!item) throw new HttpErrors.NotFound(`Process ${processId} not found.`);
        if (!item.publishedRevisionId) {
            throw new HttpErrors.UnprocessableEntity(
                `Process ${processId} has no published revision. Comments can only be added to published processes.`,
            );
        }
        return item.publishedRevisionId;
    }

    private async assertOwnership(id: string, groupId: string): Promise<{
        id?: string; revisionId: string; ngoGroupId: string; body: string;
        published: boolean; createdBy?: unknown; createdAt?: string; updatedAt?: string;
    }> {
        const comment = await this.commentRepo.findOne({ where: { id } });
        if (!comment || comment.ngoGroupId !== groupId) {
            throw new HttpErrors.NotFound(`Comment ${id} not found in your organisation.`);
        }
        return comment;
    }

    private toDto(row: {
        id?: string; revisionId: string; ngoGroupId: string; body: string;
        published: boolean; createdBy?: unknown; createdAt?: string; updatedAt?: string;
    }): NgoProcessCommentDto {
        return {
            id: row.id!, revisionId: row.revisionId, ngoGroupId: row.ngoGroupId,
            body: row.body, published: row.published,
            createdBy: row.createdBy as NgoProcessCommentDto['createdBy'],
            createdAt: row.createdAt, updatedAt: row.updatedAt,
        };
    }
}
