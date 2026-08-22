/**
 * src/services/gitea-translation-export.service.ts
 *
 * Writes translation entries to the Gitea ARB catalog.
 *
 * ── File path convention ──────────────────────────────────────────────────────
 *
 *   <category>/<isoCode>.arb          (e.g.  user-types/it.arb)
 *
 *   NO "backend/" prefix.  This must match:
 *     - gitea-init.sh   ensure_category_source_files_api()
 *     - weblate-init.sh filemask / template fields
 *     - GiteaTranslationImportService.computeRepoPath()
 *
 * ── ARB catalog format ────────────────────────────────────────────────────────
 *
 *   {
 *     "@@locale": "en",
 *     "<itemId>:<fieldKey>": "source or translated text",
 *     "@<itemId>:<fieldKey>": {
 *       "description": "translator-facing field description",
 *       "category": "...", "isoCode": "...", "itemId": "...",
 *       "fieldKey": "...", "revisionId": "...", "sourceHash": "..."
 *     }
 *   }
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 *
 *   Every PUT uses the current file SHA from Gitea. Writes are serialized per
 *   repository/branch inside this process. External conflicts are handled by
 *   reloading the latest catalog, reapplying the revision fields and retrying.
 *
 * ── Logging strategy ─────────────────────────────────────────────────────────
 *
 *   info  — operation start + result (always logged)
 *   debug — full request/response bodies, SHA values, payload details
 *   error — all failures including HTTP error bodies
 */

import { readFileSync } from 'node:fs';
import { inject, injectable, BindingScope } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings } from '@loopback/logging';
import { fetch } from 'undici';
import type { Logger } from 'winston';
import { TranslationExportRequest } from '../models/translation-export-request.model';

type GiteaConfig = {
    baseUrl: string;
    owner: string;
    repo: string;
    branch: string;
    token: string;
};

type GiteaContentResponse = {
    sha?: string;
    content?: string;
    encoding?: string;
    path?: string;
    size?: number;
};

type TranslationCatalog = Record<string, unknown>;

type LoadedCatalog = {
    exists: boolean;
    sha?: string;
    catalog: TranslationCatalog;
};

class GiteaWriteError extends Error {
    constructor(
        readonly status: number,
        readonly responseBody: string,
        message: string,
    ) {
        super(message);
        this.name = 'GiteaWriteError';
    }
}

export type TranslationRevisionExportRequest = {
    category: string;
    isoCode: string;
    itemId: string;
    fields: Record<string, string>;
    meta?: Record<string, unknown>;
    fieldOptions?: Record<string, {comment?: string; flags?: string}>;
};

export type TranslationRevisionExportResult = {
    path: string;
    keys: string[];
    branch: string;
    createdOrUpdated: 'created' | 'updated';
};

@injectable({ scope: BindingScope.SINGLETON })
export class GiteaTranslationExportService {
    private readonly repositoryWriteQueues = new Map<string, Promise<void>>();

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: Logger,
    ) { }

    async exportTranslationEntry(
        request: TranslationExportRequest,
    ): Promise<{
        path: string;
        key: string;
        branch: string;
        createdOrUpdated: 'created' | 'updated';
    }> {
        const result = await this.exportTranslationRevision({
            category: request.category,
            isoCode: request.isoCode,
            itemId: request.itemId,
            fields: {[request.fieldKey]: request.value},
            meta: request.meta,
            fieldOptions: {
                [request.fieldKey]: {
                    comment: request.comment,
                    flags: request.flags,
                },
            },
        });

        return {
            path: result.path,
            key: result.keys[0],
            branch: result.branch,
            createdOrUpdated: result.createdOrUpdated,
        };
    }

    /**
     * Writes all non-empty fields belonging to one revision with one
     * read/modify/write cycle and therefore one Gitea commit.
     */
    async exportTranslationRevision(
        request: TranslationRevisionExportRequest,
    ): Promise<TranslationRevisionExportResult> {
        this.validateRevisionRequest(request);

        const config = this.readRequiredConfig();
        const path = this.computeRepoPath(request.category, request.isoCode);
        const fieldKeys = Object.keys(request.fields);
        const keys = fieldKeys.map(fieldKey => this.buildTranslationKey(request.itemId, fieldKey));
        const lockKey = `${config.baseUrl}/${config.owner}/${config.repo}#${config.branch}`;

        this.logger.info('[GiteaExport] exportTranslationRevision start', {
            category: request.category,
            isoCode: request.isoCode,
            itemId: request.itemId,
            fieldKeys,
            keys,
            path,
            branch: config.branch,
            baseUrl: config.baseUrl,
            owner: config.owner,
            repo: config.repo,
        });

        return this.withRepositoryWriteLock(lockKey, async () => {
            const maxAttempts = 5;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                // Always reload inside the attempt. On a retry this is what
                // preserves commits made by another backend workflow or Weblate.
                const loadedCatalog = await this.loadCatalog(config, path);

                this.logger.debug('[GiteaExport] Current catalog state', {
                    path,
                    attempt,
                    exists: loadedCatalog.exists,
                    sha: loadedCatalog.sha ?? '(none)',
                    entryCount: Object.keys(loadedCatalog.catalog).length,
                    existingKeys: Object.keys(loadedCatalog.catalog),
                });

                const updatedCatalog = this.addOrUpdateRevisionEntries(
                    loadedCatalog.catalog,
                    request,
                );

                const commitMessage = loadedCatalog.exists
                    ? `Update ${request.itemId} translation revision`
                    : `Create translation catalog ${path} with ${request.itemId} revision`;

                try {
                    await this.saveCatalog(config, {
                        path,
                        catalog: updatedCatalog,
                        sha: loadedCatalog.sha,
                        exists: loadedCatalog.exists,
                        commitMessage,
                    });

                    const result = {
                        path,
                        keys,
                        branch: config.branch,
                        createdOrUpdated: (loadedCatalog.exists ? 'updated' : 'created') as
                            | 'created'
                            | 'updated',
                    };

                    this.logger.info('[GiteaExport] exportTranslationRevision done', {
                        ...result,
                        attempt,
                    });
                    return result;
                } catch (error) {
                    if (!this.isRetryableWriteError(error) || attempt === maxAttempts) {
                        throw error;
                    }

                    const delayMs = 50 * 2 ** (attempt - 1);
                    this.logger.warn('[GiteaExport] Concurrent repository update — reloading', {
                        path,
                        attempt,
                        maxAttempts,
                        delayMs,
                        status: error.status,
                        responseBody: error.responseBody,
                    });
                    await this.delay(delayMs);
                }
            }

            throw new Error(`Failed updating ${path} after ${maxAttempts} attempts.`);
        });
    }

    /**
     * The Gitea contents API creates a commit and advances the shared branch.
     * Serializing all writes to the same repository/branch prevents local
     * workflows from racing even when they update different catalog files.
     */
    private async withRepositoryWriteLock<T>(
        lockKey: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const previous = this.repositoryWriteQueues.get(lockKey) ?? Promise.resolve();
        let releaseCurrent!: () => void;
        const current = new Promise<void>(resolve => {
            releaseCurrent = resolve;
        });
        const queueTail = previous.catch(() => undefined).then(() => current);
        this.repositoryWriteQueues.set(lockKey, queueTail);

        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            releaseCurrent();
            if (this.repositoryWriteQueues.get(lockKey) === queueTail) {
                this.repositoryWriteQueues.delete(lockKey);
            }
        }
    }

    private isRetryableWriteError(error: unknown): error is GiteaWriteError {
        if (!(error instanceof GiteaWriteError)) return false;
        if (error.status === 409 || error.status >= 500) return true;
        return error.status === 422 && /already exists|conflict|sha/i.test(error.responseBody);
    }

    private async delay(milliseconds: number): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
    }

    // ── Step 1: load existing catalog (or empty if file does not exist) ───────

    private async loadCatalog(config: GiteaConfig, path: string): Promise<LoadedCatalog> {
        this.logger.debug('[GiteaExport] loadCatalog', { path });

        const response = await this.getFileFromGitea(config, path);

        if (!response) {
            this.logger.info('[GiteaExport] Catalog does not exist yet — will create', { path });
            return { exists: false, catalog: {} };
        }

        const catalog = response.content
            ? this.parseJsonContent(response.content, path)
            : {};

        this.logger.info('[GiteaExport] Catalog loaded from Gitea', {
            path,
            sha: response.sha ?? '(none)',
            size: response.size ?? 0,
            entryCount: Object.keys(catalog).length,
        });

        return { exists: true, sha: response.sha, catalog };
    }

    // ── Step 2: mutate in-memory catalog ──────────────────────────────────────

    private addOrUpdateRevisionEntries(
        catalog: TranslationCatalog,
        request: TranslationRevisionExportRequest,
    ): TranslationCatalog {
        const nextCatalog: TranslationCatalog = {
            ...catalog,
            '@@locale': request.isoCode.toLowerCase(),
        };

        for (const [fieldKey, value] of Object.entries(request.fields)) {
            const key = this.buildTranslationKey(request.itemId, fieldKey);
            const options = request.fieldOptions?.[fieldKey];
            nextCatalog[key] = value;
            nextCatalog[`@${key}`] = {
                ...(options?.comment ? {description: options.comment} : {}),
                ...(options?.flags ? {flags: options.flags} : {}),
                category: request.category,
                isoCode: request.isoCode.toLowerCase(),
                itemId: request.itemId,
                fieldKey,
                ...(request.meta ?? {}),
            };
        }

        this.logger.debug('[GiteaExport] addOrUpdateRevisionEntries', {
            itemId: request.itemId,
            fieldKeys: Object.keys(request.fields),
        });

        return nextCatalog;
    }

    // ── Step 3: persist catalog to Gitea ──────────────────────────────────────

    private async saveCatalog(
        config: GiteaConfig,
        input: {
            path: string;
            catalog: TranslationCatalog;
            sha?: string;
            exists: boolean;
            commitMessage: string;
        },
    ): Promise<void> {
        const content = `${JSON.stringify(input.catalog, null, 2)}\n`;

        this.logger.debug('[GiteaExport] saveCatalog', {
            path: input.path,
            exists: input.exists,
            sha: input.sha ?? '(none)',
            contentBytes: Buffer.byteLength(content, 'utf8'),
            commitMessage: input.commitMessage,
        });

        if (input.exists) {
            await this.updateFileInGitea(config, {
                path: input.path,
                content,
                sha: input.sha,
                message: input.commitMessage,
            });
        } else {
            await this.createFileInGitea(config, {
                path: input.path,
                content,
                message: input.commitMessage,
            });
        }
    }

    // ── Request validation ────────────────────────────────────────────────────

    private validateRequest(request: TranslationExportRequest): void {
        if (!/^[a-z0-9_-]+$/i.test(request.category)) {
            throw new HttpErrors.BadRequest(
                'Invalid category. Allowed chars: letters, numbers, underscore, dash.',
            );
        }
        if (!/^[a-z]{2}([_-][a-z0-9]+)?$/i.test(request.isoCode)) {
            throw new HttpErrors.BadRequest(
                'Invalid isoCode. Expected values like en, it, fr, pt-BR.',
            );
        }
        if (!request.itemId?.trim()) {
            throw new HttpErrors.BadRequest('itemId is required.');
        }
        if (!/^[a-z0-9_.-]+$/i.test(request.fieldKey)) {
            throw new HttpErrors.BadRequest(
                'Invalid fieldKey. Allowed chars: letters, numbers, underscore, dash, dot.',
            );
        }
        if (request.value == null || request.value === '') {
            throw new HttpErrors.BadRequest('value is required.');
        }
    }

    private validateRevisionRequest(request: TranslationRevisionExportRequest): void {
        const entries = Object.entries(request.fields);
        if (entries.length === 0) {
            throw new HttpErrors.BadRequest('At least one translation field is required.');
        }

        for (const [fieldKey, value] of entries) {
            this.validateRequest(Object.assign(new TranslationExportRequest(), {
                category: request.category,
                isoCode: request.isoCode,
                itemId: request.itemId,
                fieldKey,
                value,
                meta: request.meta,
            }));
        }
    }

    // ── Config loading ────────────────────────────────────────────────────────

    private readRequiredConfig(): GiteaConfig {
        const baseUrl = process.env.GITEA_BASE_URL?.trim();
        const owner = process.env.GITEA_TRANSLATIONS_OWNER?.trim();
        const repo = process.env.GITEA_TRANSLATIONS_REPO?.trim();
        const branch = process.env.GITEA_TRANSLATIONS_BRANCH?.trim() ?? 'main';

        let token = process.env.GITEA_TOKEN?.trim();
        if (!token) {
            const tokenFile = process.env.GITEA_TOKEN_FILE?.trim();
            if (tokenFile) {
                try {
                    const raw = readFileSync(tokenFile, 'utf8').trim();
                    if (raw) token = raw;
                } catch (err) {
                    this.logger.error('[GiteaExport] Failed to read token file', {
                        tokenFile, error: String(err),
                    });
                }
            }
        }

        const missing: string[] = [];
        if (!baseUrl) missing.push('GITEA_BASE_URL');
        if (!owner) missing.push('GITEA_TRANSLATIONS_OWNER');
        if (!repo) missing.push('GITEA_TRANSLATIONS_REPO');
        if (!token) missing.push('GITEA_TOKEN or GITEA_TOKEN_FILE');

        if (missing.length > 0) {
            this.logger.error('[GiteaExport] Missing required configuration', { missing });
            throw new Error(`Missing Gitea configuration: ${missing.join(', ')}`);
        }

        const cfg = {
            baseUrl: baseUrl!.replace(/\/$/, ''),
            owner: owner!,
            repo: repo!,
            branch,
            token: token!,
        };

        this.logger.debug('[GiteaExport] Config loaded', {
            baseUrl: cfg.baseUrl,
            owner: cfg.owner,
            repo: cfg.repo,
            branch: cfg.branch,
            tokenPrefix: cfg.token.slice(0, 4) + '...',
        });

        return cfg;
    }

    // ── Path / key helpers ────────────────────────────────────────────────────

    /**
     * Computes the Gitea file path for a (category, language) pair.
     *
     * Convention: <category>/<isoCode>.arb
     *   e.g.  user-types/it.arb
     *
     * This must match:
     *   - gitea-init.sh    path="${normalized}/${MICADO_SOURCE_LANG}.arb"
     *   - weblate-init.sh  filemask="${cat_slug}/*.arb"
     *   - GiteaTranslationImportService.computeRepoPath()
     */
    private computeRepoPath(category: string, isoCode: string): string {
        return `${category}/${isoCode.toLowerCase()}.arb`;
    }

    private buildTranslationKey(itemId: string, fieldKey: string): string {
        return `${itemId}:${fieldKey}`;
    }

    private buildContentsApiUrl(config: GiteaConfig, path: string): string {
        const encodedPath = path
            .split('/')
            .map(part => encodeURIComponent(part))
            .join('/');
        const url = `${config.baseUrl}/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`;
        this.logger.debug('[GiteaExport] Built API URL', { path, url });
        return url;
    }

    // ── Gitea HTTP operations ─────────────────────────────────────────────────

    private async getFileFromGitea(
        config: GiteaConfig,
        path: string,
    ): Promise<GiteaContentResponse | undefined> {
        const url = this.buildContentsApiUrl(config, path);
        this.logger.debug('[GiteaExport] GET file from Gitea', { url, path });

        let response: Awaited<ReturnType<typeof fetch>>;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `token ${config.token}`,
                    Accept: 'application/json',
                },
            });
        } catch (err) {
            this.logger.error('[GiteaExport] Network error on GET', { url, path, error: String(err) });
            throw new HttpErrors.BadGateway(`Network error reading Gitea: ${String(err)}`);
        }

        this.logger.debug('[GiteaExport] GET response', { path, status: response.status });

        if (response.status === 404) {
            this.logger.debug('[GiteaExport] File not found (404)', { path });
            return undefined;
        }

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('[GiteaExport] GET failed', {
                url, path, status: response.status, body,
            });
            throw new HttpErrors.BadGateway(`Failed reading file from Gitea: ${response.status}`);
        }

        const data = await response.json() as GiteaContentResponse;
        this.logger.debug('[GiteaExport] GET success', {
            path, sha: data.sha ?? '(none)', size: data.size ?? 0,
        });
        return data;
    }

    private parseJsonContent(base64Content: string, path: string): TranslationCatalog {
        let decoded: string;
        try {
            decoded = Buffer.from(base64Content.replace(/\n/g, ''), 'base64').toString('utf8');
        } catch (err) {
            this.logger.error('[GiteaExport] base64 decode failed', { path, error: String(err) });
            throw new HttpErrors.InternalServerError('Cannot decode Gitea file content.');
        }

        this.logger.debug('[GiteaExport] Decoded catalog content', {
            path, preview: decoded.slice(0, 200),
        });

        try {
            return JSON.parse(decoded) as TranslationCatalog;
        } catch (err) {
            this.logger.error('[GiteaExport] Invalid JSON in Gitea file', {
                path, error: String(err), decoded: decoded.slice(0, 500),
            });
            throw new HttpErrors.InternalServerError('Existing Gitea file does not contain valid JSON.');
        }
    }

    private async createFileInGitea(
        config: GiteaConfig,
        input: { path: string; content: string; message: string },
    ): Promise<void> {
        const url = this.buildContentsApiUrl(config, input.path);
        const payload = {
            branch: config.branch,
            content: Buffer.from(input.content, 'utf8').toString('base64'),
            message: input.message,
        };

        this.logger.debug('[GiteaExport] POST (create) to Gitea', {
            url, path: input.path, contentBytes: input.content.length,
        });

        let response: Awaited<ReturnType<typeof fetch>>;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `token ${config.token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            this.logger.error('[GiteaExport] Network error on POST (create)', {
                url, path: input.path, error: String(err),
            });
            throw new HttpErrors.BadGateway(`Network error creating Gitea file: ${String(err)}`);
        }

        this.logger.debug('[GiteaExport] POST response', { path: input.path, status: response.status });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('[GiteaExport] POST (create) failed', {
                url, path: input.path, status: response.status, body,
            });
            throw new GiteaWriteError(
                response.status,
                body,
                `Failed creating file in Gitea: ${response.status}`,
            );
        }

        this.logger.info('[GiteaExport] File created in Gitea', { path: input.path });
    }

    private async updateFileInGitea(
        config: GiteaConfig,
        input: { path: string; content: string; sha?: string; message: string },
    ): Promise<void> {
        if (!input.sha) {
            throw new Error(`Cannot update Gitea file ${input.path} without current SHA.`);
        }

        const url = this.buildContentsApiUrl(config, input.path);
        const payload = {
            branch: config.branch,
            sha: input.sha,
            content: Buffer.from(input.content, 'utf8').toString('base64'),
            message: input.message,
        };

        this.logger.debug('[GiteaExport] PUT (update) to Gitea', {
            url, path: input.path, sha: input.sha, contentBytes: input.content.length,
        });

        let response: Awaited<ReturnType<typeof fetch>>;
        try {
            response = await fetch(url, {
                method: 'PUT',
                headers: {
                    Authorization: `token ${config.token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            this.logger.error('[GiteaExport] Network error on PUT (update)', {
                url, path: input.path, sha: input.sha, error: String(err),
            });
            throw new HttpErrors.BadGateway(`Network error updating Gitea file: ${String(err)}`);
        }

        this.logger.debug('[GiteaExport] PUT response', { path: input.path, status: response.status });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('[GiteaExport] PUT (update) failed', {
                url, path: input.path, sha: input.sha, status: response.status, body,
            });
            throw new GiteaWriteError(
                response.status,
                body,
                `Failed updating file in Gitea: ${response.status}`,
            );
        }

        this.logger.info('[GiteaExport] File updated in Gitea', { path: input.path, sha: input.sha });
    }
}
