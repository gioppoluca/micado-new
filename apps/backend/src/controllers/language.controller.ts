// src/controllers/language.controller.ts
import { repository } from '@loopback/repository';
import { get, post, put, patch, del, param, requestBody } from '@loopback/rest';
import { Language } from '../models';
import { LanguageRepository } from '../repositories';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';

@authenticate('keycloak')
export class LanguageController {
    constructor(
        @repository(LanguageRepository) private repo: LanguageRepository,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: WinstonLogger,
    ) { }

    @get('/languages')
    @authorize({ allowedRoles: ['migrant_user', 'pa_editor', 'ngo_editor', 'admin'] })
    async list(
        @param.query.boolean('active') active?: boolean,
        @param.query.string('q') q?: string,
    ): Promise<Language[]> {
        const where: any = {};
        if (active !== undefined) where.active = active;

        // semplice search (puoi evolverlo con full-text)
        if (q) {
            where.or = [
                { lang: { like: `%${q}%` } },
                { isoCode: { like: `%${q}%` } },
                { name: { like: `%${q}%` } },
            ];
        }

        return this.repo.find({ where, order: ['sortOrder ASC', 'name ASC'] });
    }

    @get('/languages/{lang}')
    @authorize({ allowedRoles: ['migrant_user', 'pa_editor', 'ngo_editor', 'admin'] })
    async getOne(@param.path.string('lang') lang: string): Promise<Language> {
        return this.repo.findById(lang);
    }

    @post('/languages')
    @authorize({ allowedRoles: ['pa_editor', 'ngo_editor', 'admin'] })
    async create(@requestBody() body: Omit<Language, 'createdAt' | 'updatedAt'>): Promise<Language> {
        this.logger.info(`{ op: 'languages.create', lang: ${body.lang} }, 'Create language'`);

        // enforce single default: se body.isDefault=true, unset others
        if (body.isDefault) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true; // coerente con chk
        }
        return this.repo.create(body as Language);
    }

    @patch('/languages/{lang}')
    @authorize({ allowedRoles: ['pa_editor', 'ngo_editor', 'admin'] })
    async patchOne(
        @param.path.string('lang') lang: string,
        @requestBody() body: Partial<Language>,
    ): Promise<void> {
        this.logger.info(`{ op: 'languages.patch', ${lang}, body: ${JSON.stringify(body)} }, 'Patch language'`);

        if (body.isDefault === true) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true;
        }
        await this.repo.updateById(lang, body);
    }

    @put('/languages/{lang}')
    @authorize({ allowedRoles: ['pa_editor', 'ngo_editor', 'admin'] })
    async replaceOne(
        @param.path.string('lang') lang: string,
        @requestBody() body: Language,
    ): Promise<void> {
        this.logger.info(`{ op: 'languages.replace', lang: ${lang} }, 'Replace language'`);

        if (body.isDefault) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true;
        }
        await this.repo.replaceById(lang, body);
    }

    @del('/languages/{lang}')
    @authorize({ allowedRoles: ['admin'] })
    async deleteOne(@param.path.string('lang') lang: string): Promise<void> {
        this.logger.warn(`{ op: 'languages.delete', lang: ${lang} }, 'Delete language'`);
        await this.repo.deleteById(lang);
    }
}