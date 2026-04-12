/**
 * src/services/gitea-translation-export.service.ts
 *
 * Writes translation entries to the Gitea JSON catalog.
 *
 * ── File path convention ──────────────────────────────────────────────────────
 *
 *   <category>/<isoCode>.json         (e.g.  user-types/it.json)
 *
 *   NO "backend/" prefix.  This must match:
 *     - gitea-init.sh   ensure_category_source_files_api()
 *     - weblate-init.sh filemask / template fields
 *     - GiteaTranslationImportService.computeRepoPath()
 *
 * ── JSON catalog format ───────────────────────────────────────────────────────
 *
 *   {
 *     "<itemId>:<fieldKey>": {
 *       "value":   "source or translated text",
 *       "comment": "",
 *       "flags":   "",
 *       "meta":    { "category": "...", "isoCode": "...", "itemId": "...", "fieldKey": "..." }
 *     }
 *   }
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 *
 *   Every PUT uses the current file SHA from Gitea.
 *   If two requests race, one will get a 409 Conflict which is retried by DBOS.
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

type TranslationCatalog = Record<
    string,
    {
        value: string;
        comment: string;
        flags: string;
        meta: Record<string, unknown>;
    }
>;

type LoadedCatalog = {
    exists: boolean;
    sha?: string;
    catalog: TranslationCatalog;
};

@injectable({ scope: BindingScope.SINGLETON })
export class GiteaTranslationExportService {
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
        this.validateRequest(request);

        const config = this.readRequiredConfig();
        const path = this.computeRepoPath(request.category, request.isoCode);
        const key = this.buildTranslationKey(request.itemId, request.fieldKey);

        this.logger.info('[GiteaExport] exportTranslationEntry start', {
            category: request.category,
            isoCode: request.isoCode,
            itemId: request.itemId,
            fieldKey: request.fieldKey,
            key,
            path,
            branch: config.branch,
            baseUrl: config.baseUrl,
            owner: config.owner,
            repo: config.repo,
        });

        const loadedCatalog = await this.loadCatalog(config, path);

        this.logger.debug('[GiteaExport] Current catalog state', {
            path,
            exists: loadedCatalog.exists,
            sha: loadedCatalog.sha ?? '(none)',
            entryCount: Object.keys(loadedCatalog.catalog).length,
            existingKeys: Object.keys(loadedCatalog.catalog),
        });

        const updatedCatalog = this.addOrUpdateEntry(loadedCatalog.catalog, request);

        this.logger.debug('[GiteaExport] Updated catalog', {
            path,
            totalEntries: Object.keys(updatedCatalog).length,
            updatedKey: key,
            newValue: request.value.slice(0, 100),  // truncate for log readability
        });

        const commitMessage = loadedCatalog.exists
            ? `Update translation key ${key}`
            : `Create translation catalog ${path} with key ${key}`;

        await this.saveCatalog(config, {
            path,
            catalog: updatedCatalog,
            sha: loadedCatalog.sha,
            exists: loadedCatalog.exists,
            commitMessage,
        });

        const result = {
            path,
            key,
            branch: config.branch,
            createdOrUpdated: (loadedCatalog.exists ? 'updated' : 'created') as 'created' | 'updated',
        };

        this.logger.info('[GiteaExport] exportTranslationEntry done', result);
        return result;
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

    private addOrUpdateEntry(
        catalog: TranslationCatalog,
        request: TranslationExportRequest,
    ): TranslationCatalog {
        const key = this.buildTranslationKey(request.itemId, request.fieldKey);
        const isUpdate = key in catalog;

        const nextCatalog: TranslationCatalog = {
            ...catalog,
            [key]: {
                value: request.value,
                comment: request.comment ?? '',
                flags: request.flags ?? '',
                meta: {
                    category: request.category,
                    isoCode: request.isoCode.toLowerCase(),
                    itemId: request.itemId,
                    fieldKey: request.fieldKey,
                    ...(request.meta ?? {}),
                },
            },
        };

        this.logger.debug('[GiteaExport] addOrUpdateEntry', {
            key,
            isUpdate,
            value: request.value.slice(0, 80),
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
     * Convention: <category>/<isoCode>.json
     *   e.g.  user-types/it.json
     *
     * This must match:
     *   - gitea-init.sh    path="${normalized}/${MICADO_SOURCE_LANG}.json"
     *   - weblate-init.sh  filemask="${cat_slug}/*.json"
     *   - GiteaTranslationImportService.computeRepoPath()
     */
    private computeRepoPath(category: string, isoCode: string): string {
        return `${category}/${isoCode.toLowerCase()}.json`;
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
            throw new HttpErrors.BadGateway(`Failed creating file in Gitea: ${response.status}`);
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
            throw new HttpErrors.BadGateway(`Failed updating file in Gitea: ${response.status}`);
        }

        this.logger.info('[GiteaExport] File updated in Gitea', { path: input.path, sha: input.sha });
    }
}