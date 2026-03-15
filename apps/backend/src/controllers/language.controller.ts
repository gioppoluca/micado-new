// src/controllers/language.controller.ts
import { repository } from '@loopback/repository';
import { get, post, put, patch, del, param, requestBody, HttpErrors } from '@loopback/rest';
import { Language } from '../models';
import { LanguageRepository } from '../repositories';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';

export class LanguageController {
    constructor(
        @repository(LanguageRepository) private repo: LanguageRepository,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: WinstonLogger,
    ) { }

    @get('/languages')
    @authenticate.skip()
    async list(
        @param.query.boolean('active') active?: boolean,
        @param.query.string('q') q?: string,
    ): Promise<Language[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = {};
        if (active !== undefined) where.active = active;

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
    @authenticate.skip()
    async getOne(@param.path.string('lang') lang: string): Promise<Language> {
        return this.repo.findById(lang);
    }

    @post('/languages')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'ngo_admin', 'ngo_operator'] })
    async create(
        @requestBody() body: Omit<Language, 'createdAt' | 'updatedAt'>,
    ): Promise<Language> {
        this.logger.info(`[languages.create] lang=${body.lang}`);

        if (body.isDefault) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true;
        }
        return this.repo.create(body as Language);
    }

    @patch('/languages/{lang}')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'ngo_admin', 'ngo_operator'] })
    async patchOne(
        @param.path.string('lang') lang: string,
        @requestBody() body: Partial<Language>,
    ): Promise<void> {
        this.logger.info(`[languages.patch] lang=${lang} body=${JSON.stringify(body)}`);

        if (body.isDefault === true) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true;
        }
        await this.repo.updateById(lang, body);
    }

    @put('/languages/{lang}')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin', 'pa_operator', 'ngo_admin', 'ngo_operator'] })
    async replaceOne(
        @param.path.string('lang') lang: string,
        @requestBody() body: Language,
    ): Promise<void> {
        this.logger.info(`[languages.replace] lang=${lang}`);

        if (body.isDefault) {
            await this.repo.updateAll({ isDefault: false }, { isDefault: true });
            body.active = true;
        }
        await this.repo.replaceById(lang, body);
    }

    @del('/languages/{lang}')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin', 'ngo_admin'] })
    async deleteOne(@param.path.string('lang') lang: string): Promise<void> {
        const existing = await this.repo.findById(lang);
        if (existing.isDefault) {
            throw new HttpErrors.UnprocessableEntity(
                `Cannot delete the default language '${lang}'. Set another language as default first.`,
            );
        }
        this.logger.warn(`[languages.delete] lang=${lang}`);
        await this.repo.deleteById(lang);
    }
}