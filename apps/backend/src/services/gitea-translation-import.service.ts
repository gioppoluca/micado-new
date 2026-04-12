/**
 * src/services/gitea-translation-import.service.ts
 *
 * Reads translated JSON catalogs from Gitea and assembles per-item
 * field maps for delivery to DBOS child workflows.
 *
 * ── Gitea file path convention ────────────────────────────────────────────────
 *
 *   <category>/<lang>.json
 *
 *   e.g.  user-types/it.json
 *         news/fr.json
 *
 * ── JSON catalog format ───────────────────────────────────────────────────────
 *
 *   {
 *     "<itemId>:<fieldKey>": {
 *       "value":   "translated string",
 *       "comment": "",
 *       "flags":   "",
 *       "meta":    { "category": "...", "isoCode": "...", "itemId": "...", "fieldKey": "..." }
 *     }
 *   }
 *
 * ── Output ────────────────────────────────────────────────────────────────────
 *
 *   loadTranslatedFields() returns:
 *     { "<itemId>": { "title": "...", "description": "..." }, ... }
 *
 * This service is intentionally read-only — the export service handles writes.
 */

import { readFileSync } from 'node:fs';
import { inject, injectable, BindingScope } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings } from '@loopback/logging';
import { fetch, Response } from 'undici';
import type { Logger } from 'winston';

type GiteaConfig = {
    baseUrl: string;
    owner: string;
    repo: string;
    branch: string;
    token: string;
};

type CatalogEntry = {
    value: string;
    comment?: string;
    flags?: string;
    meta?: {
        category?: string;
        isoCode?: string;
        itemId?: string;
        fieldKey?: string;
        [key: string]: unknown;
    };
};

type RawCatalog = Record<string, CatalogEntry>;

@injectable({ scope: BindingScope.SINGLETON })
export class GiteaTranslationImportService {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: Logger,
    ) { }

    /**
     * Load all translated fields for a given (category, language) pair.
     *
     * Returns a map:  itemId → { fieldKey → translatedValue }
     *
     * Keys with empty values are included — the caller decides whether to skip.
     * If the catalog file does not exist yet, returns an empty map (no error).
     */
    async loadTranslatedFields(input: {
        category: string;
        isoCode: string;
    }): Promise<Record<string, Record<string, string>>> {

        const config = this.readRequiredConfig();
        const path = this.computeRepoPath(input.category, input.isoCode);

        this.logger.info('[GiteaImport] Loading translated catalog', {
            category: input.category,
            isoCode: input.isoCode,
            path,
            owner: config.owner,
            repo: config.repo,
            branch: config.branch,
        });

        const raw = await this.fetchCatalog(config, path);

        if (!raw) {
            this.logger.warn('[GiteaImport] Catalog file not found — returning empty map', {
                path, category: input.category, isoCode: input.isoCode,
            });
            return {};
        }

        this.logger.debug('[GiteaImport] Raw catalog loaded', {
            path, entryCount: Object.keys(raw).length, entries: Object.keys(raw),
        });

        const result = this.groupByItem(raw);

        this.logger.info('[GiteaImport] Catalog parsed', {
            category: input.category,
            isoCode: input.isoCode,
            itemCount: Object.keys(result).length,
            items: Object.keys(result),
        });
        this.logger.debug('[GiteaImport] Grouped result', { result });

        return result;
    }

    /**
     * Load the full raw catalog (key → entry) without grouping.
     * Useful for diagnostics and the test controller.
     */
    async loadRawCatalog(input: {
        category: string;
        isoCode: string;
    }): Promise<RawCatalog | null> {

        const config = this.readRequiredConfig();
        const path = this.computeRepoPath(input.category, input.isoCode);

        this.logger.info('[GiteaImport] Loading raw catalog', { path });

        return this.fetchCatalog(config, path);
    }

    // ── Path conventions ───────────────────────────────────────────────────────

    /**
     * Must match GiteaTranslationExportService.computeRepoPath() exactly.
     * Path: <category>/<isoCode>.json  (no backend/ prefix)
     */
    private computeRepoPath(category: string, isoCode: string): string {
        return `${category}/${isoCode.toLowerCase()}.json`;
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /**
     * Group { "<itemId>:<fieldKey>": { value } } → { "<itemId>": { <fieldKey>: value } }
     */
    private groupByItem(raw: RawCatalog): Record<string, Record<string, string>> {
        const result: Record<string, Record<string, string>> = {};

        for (const [compositeKey, entry] of Object.entries(raw)) {
            const colonIdx = compositeKey.indexOf(':');
            if (colonIdx === -1) {
                this.logger.warn('[GiteaImport] Skipping entry with unexpected key format', {
                    key: compositeKey,
                });
                continue;
            }

            const itemId = compositeKey.slice(0, colonIdx);
            const fieldKey = compositeKey.slice(colonIdx + 1);

            if (!result[itemId]) result[itemId] = {};
            result[itemId][fieldKey] = entry.value ?? '';
        }

        return result;
    }

    private async fetchCatalog(config: GiteaConfig, path: string): Promise<RawCatalog | null> {
        const url = this.buildContentsApiUrl(config, path);

        this.logger.debug('[GiteaImport] GET Gitea file', { url, path });

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `token ${config.token}`,
                    Accept: 'application/json',
                },
            }) as unknown as Response;
        } catch (err) {
            this.logger.error('[GiteaImport] Network error fetching from Gitea', { url, error: String(err) });
            throw new HttpErrors.BadGateway(`Network error fetching Gitea file: ${String(err)}`);
        }

        this.logger.debug('[GiteaImport] Gitea response status', { status: response.status, path });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('[GiteaImport] Gitea returned error', {
                url, path, status: response.status, body,
            });
            throw new HttpErrors.BadGateway(`Gitea returned ${response.status} for ${path}`);
        }

        const json = await response.json() as { content?: string; encoding?: string; sha?: string };

        this.logger.debug('[GiteaImport] Gitea file metadata', {
            path, sha: json.sha, encoding: json.encoding,
            contentLength: json.content?.length ?? 0,
        });

        if (!json.content) {
            this.logger.warn('[GiteaImport] Gitea file has no content field', { path });
            return {};
        }

        return this.parseBase64Json(json.content, path);
    }

    private parseBase64Json(base64Content: string, path: string): RawCatalog {
        let decoded: string;
        try {
            decoded = Buffer.from(base64Content.replace(/\n/g, ''), 'base64').toString('utf8');
        } catch (err) {
            this.logger.error('[GiteaImport] Failed to base64-decode Gitea content', { path, error: String(err) });
            throw new HttpErrors.InternalServerError(`Cannot decode Gitea file: ${path}`);
        }

        this.logger.debug('[GiteaImport] Decoded content preview', {
            path, preview: decoded.slice(0, 200),
        });

        try {
            return JSON.parse(decoded) as RawCatalog;
        } catch (err) {
            this.logger.error('[GiteaImport] Invalid JSON in Gitea file', {
                path, error: String(err), decoded: decoded.slice(0, 500),
            });
            throw new HttpErrors.InternalServerError(`Invalid JSON in Gitea file: ${path}`);
        }
    }

    private buildContentsApiUrl(config: GiteaConfig, path: string): string {
        const encodedPath = path
            .split('/')
            .map(part => encodeURIComponent(part))
            .join('/');
        return `${config.baseUrl}/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`;
    }

    private readRequiredConfig(): GiteaConfig {
        const baseUrl = process.env.GITEA_BASE_URL?.trim();
        const owner = process.env.GITEA_TRANSLATIONS_OWNER?.trim();
        const repo = process.env.GITEA_TRANSLATIONS_REPO?.trim();
        const branch = process.env.GITEA_TRANSLATIONS_BRANCH?.trim() ?? 'main';

        let token = process.env.GITEA_TOKEN?.trim();
        if (!token) {
            const tokenFile = process.env.GITEA_TOKEN_FILE?.trim();
            if (tokenFile) {
                const raw = readFileSync(tokenFile, 'utf8').trim();
                if (raw) token = raw;
            }
        }

        const missing: string[] = [];
        if (!baseUrl) missing.push('GITEA_BASE_URL');
        if (!owner) missing.push('GITEA_TRANSLATIONS_OWNER');
        if (!repo) missing.push('GITEA_TRANSLATIONS_REPO');
        if (!token) missing.push('GITEA_TOKEN or GITEA_TOKEN_FILE');

        if (missing.length > 0) {
            this.logger.error('[GiteaImport] Missing configuration', { missing });
            throw new Error(`Missing Gitea configuration: ${missing.join(', ')}`);
        }

        return {
            baseUrl: baseUrl!.replace(/\/$/, ''),
            owner: owner!,
            repo: repo!,
            branch,
            token: token!,
        };
    }
}