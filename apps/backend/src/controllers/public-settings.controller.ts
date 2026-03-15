import { repository } from '@loopback/repository';
import { get, patch, param, requestBody, response, HttpErrors } from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { SettingRepository } from '../repositories/setting.repository';

export class PublicSettingsController {
    constructor(
        @repository(SettingRepository)
        private settingsRepo: SettingRepository,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: WinstonLogger,
    ) { }

    @get('/public/settings')
    @authenticate.skip()
    @response(200, {
        description: 'List all public settings',
        content: {
            'application/json': {
                schema: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            key: { type: 'string' },
                            value: { type: 'string' },
                        },
                    },
                },
            },
        },
    })
    async list(
        @param.query.string('prefix') prefix?: string,
    ): Promise<{ key: string; value: string }[]> {
        const rows = await this.settingsRepo.find({
            where: prefix ? { key: { like: `${prefix}%` } } : undefined,
            order: ['key ASC'],
        });
        return rows.map(r => ({ key: r.key, value: r.value }));
    }

    @get('/public/settings/{key}')
    @authenticate.skip()
    @response(200, {
        description: 'Get a single public setting by key',
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        key: { type: 'string' },
                        value: { type: 'string' },
                    },
                },
            },
        },
    })
    async getByKey(
        @param.path.string('key') key: string,
    ): Promise<{ key: string; value: string }> {
        const row = await this.settingsRepo.findById(key);
        return { key: row.key, value: row.value };
    }

    @patch('/settings/{key}')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator'] })
    @response(200, {
        description: 'Update a setting by key',
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        key: { type: 'string' },
                        value: { type: 'string' },
                    },
                },
            },
        },
    })
    async patchByKey(
        @param.path.string('key') key: string,
        @requestBody() body: { value: string },
    ): Promise<{ key: string; value: string }> {
        if (body.value === undefined || body.value === null) {
            throw new HttpErrors.UnprocessableEntity('value is required');
        }
        this.logger.info(`[settings.patch] key=${key}`);
        const existing = await this.settingsRepo.findOne({ where: { key } });
        if (existing) {
            await this.settingsRepo.updateById(key, { value: body.value });
        } else {
            await this.settingsRepo.create({ key, value: body.value });
        }
        return { key, value: body.value };
    }
}