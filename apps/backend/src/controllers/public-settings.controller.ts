import { repository } from '@loopback/repository';
import { get, param, response } from '@loopback/rest';
import { SettingRepository } from '../repositories/setting.repository';

export class PublicSettingsController {
    constructor(
        @repository(SettingRepository)
        private settingsRepo: SettingRepository,
    ) { }

    @get('/public/settings')
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
        @param.query.string('prefix') prefix = 'public.',
    ): Promise<{ key: string; value: string }[]> {
        const rows = await this.settingsRepo.find({
            where: { key: { like: `${prefix}%` } },
            order: ['key ASC'],
        });
        return rows.map(r => ({ key: r.key, value: r.value }));
    }

    @get('/public/settings/{key}')
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
        const fullKey = key.startsWith('public.') ? key : `public.${key}`;
        const row = await this.settingsRepo.findById(fullKey);
        return { key: row.key, value: row.value };
    }
}