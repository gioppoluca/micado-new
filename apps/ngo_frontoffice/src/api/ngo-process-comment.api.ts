/**
 * src/api/ngo-process-comment.api.ts
 *
 * HTTP calls for NGO process comments.
 *
 * Backend endpoints (NgoProcessCommentsController):
 *   GET  /ngo/process-comments?processId=  List my group's comments for a process
 *   POST /ngo/process-comments             Create a comment
 *   PUT  /ngo/process-comments/:id         Update body + published flag
 *   DEL  /ngo/process-comments/:id         Delete
 *
 * Auth: ngo_admin | ngo_operator
 * Group scoping: enforced on the backend — caller never passes groupId.
 */

import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPost, apiPut } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NgoProcessComment {
    id: string;
    revisionId: string;
    ngoGroupId: string;
    body: string;
    /** FALSE = draft (only visible in NGO backoffice). TRUE = shown to migrants. */
    published: boolean;
    createdBy?: { sub: string; username: string; name: string; realm: string };
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateNgoCommentPayload {
    /** Process externalKey (integer id) — backend resolves the current published revisionId */
    processId: number;
    body: string;
    published?: boolean;
}

export interface UpdateNgoCommentPayload {
    body: string;
    published?: boolean;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const ngoProcessCommentApi = {
    /**
     * List all comments written by the caller's NGO group for the currently
     * published revision of the given process.
     */
    async list(processId: number): Promise<NgoProcessComment[]> {
        logger.info('[ngo-process-comment.api] list', { processId });
        return apiGet<NgoProcessComment[]>('/ngo/process-comments', {
            params: { processId },
        });
    },

    /**
     * Create a comment on the current published revision.
     * The backend resolves the revisionId from processId server-side.
     */
    async create(payload: CreateNgoCommentPayload): Promise<NgoProcessComment> {
        logger.info('[ngo-process-comment.api] create', { processId: payload.processId });
        return apiPost<NgoProcessComment>('/ngo/process-comments', payload);
    },

    /**
     * Update body text and/or published flag.
     */
    async update(id: string, payload: UpdateNgoCommentPayload): Promise<NgoProcessComment> {
        logger.info('[ngo-process-comment.api] update', { id, published: payload.published });
        return apiPut<NgoProcessComment>(`/ngo/process-comments/${id}`, payload);
    },

    /**
     * Delete a comment.
     */
    async remove(id: string): Promise<void> {
        logger.warn('[ngo-process-comment.api] remove', { id });
        return apiDelete(`/ngo/process-comments/${id}`);
    },
};
