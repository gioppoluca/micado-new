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

        this.logger.info('Exporting translation entry to Gitea', {
            category: request.category,
            isoCode: request.isoCode,
            itemId: request.itemId,
            fieldKey: request.fieldKey,
            key,
            path,
            branch: config.branch,
            owner: config.owner,
            repo: config.repo,
        });

        const loadedCatalog = await this.loadCatalog(config, path);

        const updatedCatalog = this.addOrUpdateEntry(loadedCatalog.catalog, request);

        await this.saveCatalog(config, {
            path,
            catalog: updatedCatalog,
            sha: loadedCatalog.sha,
            exists: loadedCatalog.exists,
            commitMessage: loadedCatalog.exists
                ? `Update translation key ${key}`
                : `Create translation catalog ${path} with key ${key}`,
        });

        this.logger.info('Translation entry exported successfully', {
            key,
            path,
            branch: config.branch,
            createdOrUpdated: loadedCatalog.exists ? 'updated' : 'created',
        });

        return {
            path,
            key,
            branch: config.branch,
            createdOrUpdated: loadedCatalog.exists ? 'updated' : 'created',
        };
    }

    /**
     * Step 1: always try to load the existing file and its SHA from Gitea.
     * If missing, start from an empty catalog.
     */
    private async loadCatalog(
        config: GiteaConfig,
        path: string,
    ): Promise<LoadedCatalog> {
        const response = await this.getFileFromGitea(config, path);

        if (!response) {
            this.logger.info('Gitea catalog does not exist yet, starting from empty', {
                path,
            });

            return {
                exists: false,
                catalog: {},
            };
        }

        const catalog = response.content
            ? this.parseJsonContent(response.content)
            : {};

        this.logger.info('Loaded Gitea catalog successfully', {
            path,
            sha: response.sha ?? null,
            exists: true,
            entryCount: Object.keys(catalog).length,
        });

        return {
            exists: true,
            sha: response.sha,
            catalog,
        };
    }

    /**
     * Step 2: apply mutation to the in-memory JSON catalog.
     * For now we only support add/update of one translation key.
     */
    private addOrUpdateEntry(
        catalog: TranslationCatalog,
        request: TranslationExportRequest,
    ): TranslationCatalog {
        const key = this.buildTranslationKey(request.itemId, request.fieldKey);

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

        return nextCatalog;
    }

    /**
     * Step 3: save the catalog back to Gitea.
     * - POST when the file does not exist
     * - PUT with SHA when the file already exists
     */
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

        if (input.exists) {
            await this.updateFileInGitea(config, {
                path: input.path,
                content,
                sha: input.sha,
                message: input.commitMessage,
            });
            return;
        }

        await this.createFileInGitea(config, {
            path: input.path,
            content,
            message: input.commitMessage,
        });
    }

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
                if (raw) {
                    token = raw;
                }
            }
        }

        const missing: string[] = [];
        if (!baseUrl) missing.push('GITEA_BASE_URL');
        if (!owner) missing.push('GITEA_TRANSLATIONS_OWNER');
        if (!repo) missing.push('GITEA_TRANSLATIONS_REPO');
        if (!token) missing.push('GITEA_TOKEN or GITEA_TOKEN_FILE');

        if (missing.length > 0) {
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

        return `${config.baseUrl}/api/v1/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`;
    }

    /**
     * GET file metadata + content from Gitea.
     * Returns undefined on 404.
     */
    private async getFileFromGitea(
        config: GiteaConfig,
        path: string,
    ): Promise<GiteaContentResponse | undefined> {
        const url = this.buildContentsApiUrl(config, path);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `token ${config.token}`,
                Accept: 'application/json',
            },
        });

        if (response.status === 404) {
            return undefined;
        }

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('Failed reading file from Gitea', {
                url,
                path,
                status: response.status,
                body,
            });
            throw new HttpErrors.BadGateway(
                `Failed reading file from Gitea: ${response.status}`,
            );
        }

        return (await response.json()) as GiteaContentResponse;
    }

    private parseJsonContent(base64Content: string): TranslationCatalog {
        const raw = Buffer.from(base64Content.replace(/\n/g, ''), 'base64').toString(
            'utf8',
        );

        try {
            return JSON.parse(raw) as TranslationCatalog;
        } catch (error) {
            this.logger.error('Invalid JSON content found in Gitea file', { error });
            throw new HttpErrors.InternalServerError(
                'Existing Gitea file does not contain valid JSON.',
            );
        }
    }

    private async createFileInGitea(
        config: GiteaConfig,
        input: {
            path: string;
            content: string;
            message: string;
        },
    ): Promise<void> {
        const url = this.buildContentsApiUrl(config, input.path);

        const payload = {
            branch: config.branch,
            content: Buffer.from(input.content, 'utf8').toString('base64'),
            message: input.message,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `token ${config.token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('Failed creating file in Gitea', {
                url,
                path: input.path,
                status: response.status,
                body,
            });
            throw new HttpErrors.BadGateway(
                `Failed creating file in Gitea: ${response.status}`,
            );
        }
    }

    private async updateFileInGitea(
        config: GiteaConfig,
        input: {
            path: string;
            content: string;
            sha?: string;
            message: string;
        },
    ): Promise<void> {
        if (!input.sha) {
            throw new Error(
                `Cannot update Gitea file ${input.path} without current SHA.`,
            );
        }

        const url = this.buildContentsApiUrl(config, input.path);

        const payload = {
            branch: config.branch,
            sha: input.sha,
            content: Buffer.from(input.content, 'utf8').toString('base64'),
            message: input.message,
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `token ${config.token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error('Failed updating file in Gitea', {
                url,
                path: input.path,
                sha: input.sha,
                status: response.status,
                body,
            });
            throw new HttpErrors.BadGateway(
                `Failed updating file in Gitea: ${response.status}`,
            );
        }
    }
}