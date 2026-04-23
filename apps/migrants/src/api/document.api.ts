/**
 * src/api/document.api.ts
 *
 * HTTP calls for the migrant document wallet.
 *
 * Backend endpoints (MigrantDocumentsController):
 *   GET  /documents-migrant         List caller's documents (summaries, no binary)
 *   POST /documents-migrant         Upload a new document
 *   GET  /documents-migrant/:id     Fetch single document including base64 binary
 *   PUT  /documents-migrant/:id     Update metadata and/or replace binary
 *   DEL  /documents-migrant/:id     Delete document
 *
 * All endpoints: authenticated migrant only (Bearer token required).
 *
 * ── Binary handling ───────────────────────────────────────────────────────────
 *
 *   Upload:  The caller reads the file via FileReader.readAsDataURL() which
 *            produces a data-URI string (e.g. "data:image/jpeg;base64,...").
 *            The full data-URI is accepted by the backend (it strips the prefix).
 *
 *   Display: The backend returns fileData as a plain base64 string (no prefix).
 *            buildDataUri() reconstructs the data-URI for use in <img src> or
 *            for programmatic download.
 */

import { logger } from 'src/services/Logger';
import { apiDelete, apiGet, apiPost, apiPut } from './client';
import type { MockRegistry, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Summary row returned by the list endpoint — no binary. */
export interface MigrantDocumentSummary {
    id: string;
    migrantId: string;
    documentTypeId?: number;
    fileName: string;
    mimeType: string;
    shareable: boolean;
    createdAt?: string;
    updatedAt?: string;
}

/** Full document including base64-encoded binary. */
export interface MigrantDocument extends MigrantDocumentSummary {
    /** Plain base64 (no data-URI prefix). */
    fileData: string;
}

export interface UploadDocumentPayload {
    documentTypeId?: number;
    fileName: string;
    mimeType: string;
    /** Full data-URI ("data:image/jpeg;base64,...") or plain base64. */
    fileData: string;
    shareable?: boolean;
}

export interface UpdateDocumentPayload {
    documentTypeId?: number;
    fileName?: string;
    shareable?: boolean;
    /** Optional new file content. */
    fileData?: string;
    mimeType?: string;
}

/** Reconstruct a data-URI from a plain base64 string + MIME type. */
export function buildDataUri(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const documentApi = {
    /** List all documents (summaries, no binary). */
    async list(): Promise<MigrantDocumentSummary[]> {
        logger.info('[document.api] list');
        return apiGet<MigrantDocumentSummary[]>('/documents-migrant');
    },

    /** Fetch a single document including binary content. */
    async getOne(id: string): Promise<MigrantDocument> {
        logger.info('[document.api] getOne', { id });
        return apiGet<MigrantDocument>(`/documents-migrant/${id}`);
    },

    /** Upload a new document. Returns the created record with binary. */
    async upload(payload: UploadDocumentPayload): Promise<MigrantDocument> {
        logger.info('[document.api] upload', {
            fileName: payload.fileName, mimeType: payload.mimeType,
        });
        return apiPost<MigrantDocument>('/documents-migrant', payload);
    },

    /** Update document metadata and/or replace the binary. */
    async update(id: string, payload: UpdateDocumentPayload): Promise<MigrantDocument> {
        logger.info('[document.api] update', { id });
        return apiPut<MigrantDocument>(`/documents-migrant/${id}`, payload);
    },

    /** Delete a document. */
    async remove(id: string): Promise<void> {
        logger.warn('[document.api] remove', { id });
        return apiDelete(`/documents-migrant/${id}`);
    },

    /**
     * List available send-to email contacts (NGO groups + PA).
     * Public endpoint — no auth required (but token is sent if available).
     */
    async listContactEmails(): Promise<ContactEmailOption[]> {
        logger.info('[document.api] listContactEmails');
        return apiGet<ContactEmailOption[]>('/ngo/contact-emails');
    },

    /**
     * Send a document as an email attachment to the given address.
     * Returns { sentTo: string } on success.
     * Throws ApiError on SMTP failure (status 502) or server misconfiguration (503).
     */
    async sendByEmail(id: string, payload: SendDocumentPayload): Promise<SendDocumentResult> {
        logger.info('[document.api] sendByEmail', { id, to: payload.email });
        return apiPost<SendDocumentResult>(`/documents-migrant/${id}/send-email`, payload);
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_DOCS: MigrantDocument[] = [
    {
        id: 'doc-1',
        migrantId: 'mock-sub',
        documentTypeId: 2,
        fileName: 'identity_card.jpg',
        mimeType: 'image/jpeg',
        fileData: '',   // empty in mock — detail fetch provides data
        shareable: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'doc-2',
        migrantId: 'mock-sub',
        documentTypeId: 3,
        fileName: 'residence_permit.pdf',
        mimeType: 'application/pdf',
        fileData: '',
        shareable: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];

// ─── Contact email types ──────────────────────────────────────────────────────

/** One entry in the send-to dropdown. */
export interface ContactEmailOption {
    displayName: string;
    email: string;
}

export interface SendDocumentPayload {
    email: string;
}

export interface SendDocumentResult {
    sentTo: string;
}

export function registerDocumentMocks(mock: MockRegistry): void {
    // GET /documents-migrant
    mock.onGet('/documents-migrant').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /documents-migrant', { count: MOCK_DOCS.length });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return [200, MOCK_DOCS.map(({ fileData, ...rest }) => rest)];
    });

    // GET /documents-migrant/:id
    mock.onGet(/\/documents-migrant\/[\w-]+$/).reply((config): MockReplyTuple => {
        const id = (config.url ?? '').split('/').pop()!;
        const doc = MOCK_DOCS.find(d => d.id === id);
        if (!doc) return [404, { error: { message: `Document ${id} not found.` } }];
        logger.debug('[mock] GET /documents-migrant/:id', { id });
        return [200, doc];
    });

    // POST /documents-migrant
    mock.onPost('/documents-migrant').reply((config): MockReplyTuple => {
        logger.debug('[mock] POST /documents-migrant');
        const newDoc: MigrantDocument = {
            id: `doc-${Date.now()}`,
            migrantId: 'mock-sub',
            fileName: 'new-document.jpg',
            mimeType: 'image/jpeg',
            fileData: '',
            shareable: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...(config as Record<string, unknown>),
        };
        MOCK_DOCS.push(newDoc);
        return [200, newDoc];
    });

    // PUT /documents-migrant/:id
    mock.onPut(/\/documents-migrant\/[\w-]+$/).reply((config): MockReplyTuple => {
        const id = (config.url ?? '').split('/').pop()!;
        const idx = MOCK_DOCS.findIndex(d => d.id === id);
        if (idx === -1) return [404, { error: { message: `Document ${id} not found.` } }];
        MOCK_DOCS[idx] = { ...MOCK_DOCS[idx]!, updatedAt: new Date().toISOString() };
        return [200, MOCK_DOCS[idx]];
    });

    // DELETE /documents-migrant/:id
    mock.onDelete(/\/documents-migrant\/[\w-]+$/).reply((config): MockReplyTuple => {
        const id = (config.url ?? '').split('/').pop()!;
        const idx = MOCK_DOCS.findIndex(d => d.id === id);
        if (idx === -1) return [404, { error: { message: `Document ${id} not found.` } }];
        MOCK_DOCS.splice(idx, 1);
        return [204];
    });

    // GET /ngo/contact-emails
    mock.onGet('/ngo/contact-emails').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /ngo/contact-emails');
        return [200, [
            { displayName: 'Public Administration', email: 'pa@micado.example.eu' },
            { displayName: 'Red Cross NGO', email: 'redcross@micado.example.eu' },
        ]];
    });

    // POST /documents-migrant/:id/send-email
    mock.onPost(/\/documents-migrant\/[\w-]+\/send-email$/).reply((): MockReplyTuple => {
        logger.debug('[mock] POST /documents-migrant/:id/send-email');
        return [200, { sentTo: 'test@example.com' }];
    });

    logger.debug('[mock] document handlers registered');
}
