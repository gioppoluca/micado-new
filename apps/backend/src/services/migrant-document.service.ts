/**
 * src/services/migrant-document.service.ts
 *
 * Business logic for the Document Wallet.
 *
 * ── Ownership ─────────────────────────────────────────────────────────────────
 *
 *  Every method accepts `callerSub: string` (the Keycloak UUID from the JWT
 *  sub claim) and enforces that the migrant can only access their own documents.
 *  The sub is passed explicitly from the controller via SecurityBindings.USER
 *  rather than injected into the service, keeping the service testable without
 *  a full LB4 context.
 *
 * ── Binary handling ───────────────────────────────────────────────────────────
 *
 *  The API accepts base64-encoded file content in the request body.
 *  The service converts it to a Buffer before persistence and converts
 *  Buffer back to base64 string in the DTO before returning to the client.
 *  PostgreSQL BYTEA ↔ Node.js Buffer is handled by the loopback-connector-postgresql.
 *
 * ── File size limit ───────────────────────────────────────────────────────────
 *
 *  MAX_FILE_BYTES is enforced before writing.  The default is 10 MB.
 *  It can be overridden via the DOCUMENT_MAX_BYTES env var.
 *
 * ── migrant_profile upsert ───────────────────────────────────────────────────
 *
 *  Like the intervention-plan service, we auto-upsert the migrant_profile row
 *  on first write so the FK constraint is never violated.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { v4 as uuidv4 } from 'uuid';
import { MigrantDocumentRepository } from '../repositories/migrant-document.repository';
import { MigrantProfileRepository } from '../repositories/migrant-profile.repository';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

/** Document as returned by the API — fileData encoded as base64 string. */
export interface MigrantDocumentDto {
    id: string;
    migrantId: string;
    documentTypeId?: number;
    fileName: string;
    mimeType: string;
    /** Base64-encoded file content. */
    fileData: string;
    shareable: boolean;
    createdAt?: string;
    updatedAt?: string;
}

/** Document summary (no binary) — used in the list response. */
export interface MigrantDocumentSummaryDto {
    id: string;
    migrantId: string;
    documentTypeId?: number;
    fileName: string;
    mimeType: string;
    shareable: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateMigrantDocumentInput {
    documentTypeId?: number;
    fileName: string;
    mimeType: string;
    /** Base64-encoded file content. */
    fileData: string;
    shareable?: boolean;
}

export interface UpdateMigrantDocumentInput {
    documentTypeId?: number;
    fileName?: string;
    shareable?: boolean;
    /** Optional: provide a new base64-encoded file to replace the existing one. */
    fileData?: string;
    mimeType?: string;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

@injectable({ scope: BindingScope.TRANSIENT })
export class MigrantDocumentService {
    private readonly maxFileBytes: number;

    constructor(
        @repository(MigrantDocumentRepository)
        private readonly documentRepo: MigrantDocumentRepository,
        @repository(MigrantProfileRepository)
        private readonly profileRepo: MigrantProfileRepository,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) {
        this.maxFileBytes =
            process.env.DOCUMENT_MAX_BYTES
                ? parseInt(process.env.DOCUMENT_MAX_BYTES, 10)
                : DEFAULT_MAX_BYTES;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * List all documents owned by the caller.
     * Returns summaries (no binary) for list display.
     */
    async list(callerSub: string): Promise<MigrantDocumentSummaryDto[]> {
        const rows = await this.documentRepo.find({
            where: { migrantId: callerSub },
            order: ['createdAt DESC'],
            // Exclude fileData from the list query — it can be large
            fields: {
                id: true, migrantId: true, documentTypeId: true,
                fileName: true, mimeType: true, shareable: true,
                createdAt: true, updatedAt: true,
                fileData: false,
            },
        });

        this.logger.info('[MigrantDocumentService.list]', {
            migrantId: callerSub, count: rows.length,
        });

        return rows.map(r => this.toSummaryDto(r));
    }

    /**
     * Fetch a single document including its binary content.
     * Throws 404 when the document does not exist or belongs to another migrant.
     */
    async getOne(callerSub: string, id: string): Promise<MigrantDocumentDto> {
        const doc = await this.documentRepo.findOne({ where: { id } });
        this.assertOwnership(doc, callerSub, id);
        return this.toDto(doc!);
    }

    /**
     * Create a new document. Auto-upserts the migrant_profile row.
     */
    async create(
        callerSub: string,
        input: CreateMigrantDocumentInput,
    ): Promise<MigrantDocumentDto> {
        const fileBuffer = this.decodeBase64(input.fileData, input.fileName);
        await this.ensureProfile(callerSub);

        const created = await this.documentRepo.create({
            id: uuidv4(),
            migrantId: callerSub,
            ...(input.documentTypeId !== undefined && { documentTypeId: input.documentTypeId }),
            fileName: input.fileName.trim(),
            mimeType: input.mimeType.trim(),
            fileData: fileBuffer,
            shareable: input.shareable ?? false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        this.logger.info('[MigrantDocumentService.create]', {
            migrantId: callerSub, id: created.id,
            fileName: input.fileName, bytes: fileBuffer.length,
        });

        return this.toDto(created);
    }

    /**
     * Update document metadata and/or replace the binary.
     */
    async update(
        callerSub: string,
        id: string,
        input: UpdateMigrantDocumentInput,
    ): Promise<MigrantDocumentDto> {
        const existing = await this.documentRepo.findOne({ where: { id } });
        this.assertOwnership(existing, callerSub, id);

        const patch: Record<string, unknown> = {
            updatedAt: new Date().toISOString(),
        };

        if (input.documentTypeId !== undefined) patch['documentTypeId'] = input.documentTypeId;
        if (input.fileName !== undefined) patch['fileName'] = input.fileName.trim();
        if (input.shareable !== undefined) patch['shareable'] = input.shareable;
        if (input.fileData !== undefined) {
            const mimeType = input.mimeType ?? existing!.mimeType;
            const buffer = this.decodeBase64(input.fileData, existing!.fileName);
            patch['fileData'] = buffer;
            patch['mimeType'] = mimeType;
        }

        await this.documentRepo.updateById(id, patch);

        this.logger.info('[MigrantDocumentService.update]', { migrantId: callerSub, id });

        // Re-fetch the updated row so we return a consistent DTO
        const updated = await this.documentRepo.findOne({ where: { id } });
        return this.toDto(updated!);
    }

    /**
     * Delete a document.
     */
    async delete(callerSub: string, id: string): Promise<void> {
        const existing = await this.documentRepo.findOne({ where: { id } });
        this.assertOwnership(existing, callerSub, id);
        await this.documentRepo.deleteById(id);
        this.logger.warn('[MigrantDocumentService.delete]', { migrantId: callerSub, id });
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private assertOwnership(
        doc: { migrantId: string } | null | undefined,
        callerSub: string,
        id: string,
    ): asserts doc is NonNullable<typeof doc> {
        if (!doc || doc.migrantId !== callerSub) {
            throw new HttpErrors.NotFound(`Document ${id} not found.`);
        }
    }

    private decodeBase64(b64: string, fileName: string): Buffer {
        // Strip data-URI prefix if present (e.g. "data:image/jpeg;base64,...")
        const raw = b64.includes(',') ? b64.split(',')[1] : b64;
        const buffer = Buffer.from(raw!, 'base64');

        if (buffer.length > this.maxFileBytes) {
            throw new HttpErrors.PayloadTooLarge(
                `File "${fileName}" exceeds the maximum allowed size of ` +
                `${Math.round(this.maxFileBytes / 1024 / 1024)} MB.`,
            );
        }

        return buffer;
    }

    private async ensureProfile(keycloakId: string): Promise<void> {
        const exists = await this.profileRepo.findOne({ where: { keycloakId } });
        if (!exists) {
            await this.profileRepo.create({
                keycloakId,
                realm: 'migrants',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            this.logger.info('[MigrantDocumentService] auto-created migrant_profile', { keycloakId });
        }
    }

    private toDto(doc: InstanceType<typeof import('../models').MigrantDocument>): MigrantDocumentDto {
        return {
            id: doc.id!,
            migrantId: doc.migrantId,
            ...(doc.documentTypeId !== undefined && { documentTypeId: doc.documentTypeId }),
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            fileData: Buffer.isBuffer(doc.fileData)
                ? doc.fileData.toString('base64')
                : String(doc.fileData ?? ''),
            shareable: doc.shareable,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }

    private toSummaryDto(doc: Partial<InstanceType<typeof import('../models').MigrantDocument>>): MigrantDocumentSummaryDto {
        return {
            id: doc.id!,
            migrantId: doc.migrantId!,
            ...(doc.documentTypeId !== undefined && { documentTypeId: doc.documentTypeId }),
            fileName: doc.fileName ?? '',
            mimeType: doc.mimeType ?? '',
            shareable: doc.shareable ?? false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }
}
