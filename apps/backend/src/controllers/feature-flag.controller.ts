// src/controllers/feature-flag.controller.ts
//
// AUTH-GATED — PA admin only.
// Provides full CRUD for flags and their i18n labels.
//
import { repository } from '@loopback/repository';
import { get, post, patch, del, param, requestBody, HttpErrors, response } from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { FeatureFlag, FeatureFlagI18n } from '../models';
import { FeatureFlagRepository, FeatureFlagI18nRepository } from '../repositories';

// Shape returned to the PA admin list — flag + its label for the requested lang
export type FeatureFlagWithLabel = {
    id: number;
    flagKey: string;
    enabled: boolean;
    label: string | null;
};

@authenticate('keycloak')
export class FeatureFlagController {
    constructor(
        @repository(FeatureFlagRepository)
        private flagRepo: FeatureFlagRepository,
        @repository(FeatureFlagI18nRepository)
        private i18nRepo: FeatureFlagI18nRepository,
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: WinstonLogger,
    ) { }

    // ------------------------------------------------------------------
    // Flags
    // ------------------------------------------------------------------

    /**
     * List all flags, optionally with the translated label for a given lang.
     * GET /features-flags?lang=it
     */
    @get('/features-flags')
    @authorize({ allowedRoles: ['pa_editor', 'admin'] })
    async list(
        @param.query.string('lang') lang?: string,
    ): Promise<FeatureFlagWithLabel[]> {
        const flags = await this.flagRepo.find({ order: ['flagKey ASC'] });

        if (!lang) {
            return flags.map(f => ({ id: f.id, flagKey: f.flagKey, enabled: f.enabled, label: null }));
        }

        // Bulk-fetch labels for the requested lang
        const flagIds = flags.map(f => f.id);
        const labels = await this.i18nRepo.find({
            where: { flagId: { inq: flagIds }, lang },
        });
        const labelMap = new Map(labels.map(l => [l.flagId, l.label]));

        return flags.map(f => ({
            id: f.id,
            flagKey: f.flagKey,
            enabled: f.enabled,
            label: labelMap.get(f.id) ?? null,
        }));
    }

    /** GET /features-flags/:id */
    @get('/features-flags/{id}')
    @authorize({ allowedRoles: ['pa_editor', 'admin'] })
    async getOne(@param.path.number('id') id: number): Promise<FeatureFlag> {
        return this.flagRepo.findById(id);
    }

    /** POST /features-flags */
    @post('/features-flags')
    @authorize({ allowedRoles: ['admin'] })
    async create(
        @requestBody() body: Pick<FeatureFlag, 'flagKey' | 'enabled'>,
    ): Promise<FeatureFlag> {
        this.logger.info(`[features-flags.create] flagKey=${body.flagKey}`);
        return this.flagRepo.create(body as FeatureFlag);
    }

    /** PATCH /features-flags/:id  — toggle enabled or rename */
    @patch('/features-flags/{id}')
    @authorize({ allowedRoles: ['pa_editor', 'admin'] })
    async patchOne(
        @param.path.number('id') id: number,
        @requestBody() body: Partial<Pick<FeatureFlag, 'enabled' | 'flagKey'>>,
    ): Promise<void> {
        this.logger.info(`[features-flags.patch] id=${id} body=${JSON.stringify(body)}`);
        await this.flagRepo.updateById(id, body as Partial<FeatureFlag>);
    }

    /** DELETE /features-flags/:id */
    @del('/features-flags/{id}')
    @authorize({ allowedRoles: ['admin'] })
    async deleteOne(@param.path.number('id') id: number): Promise<void> {
        this.logger.warn(`[features-flags.delete] id=${id}`);
        await this.flagRepo.deleteById(id);
    }

    // ------------------------------------------------------------------
    // i18n labels — managed by devs/admins directly, no Weblate
    // ------------------------------------------------------------------

    /** GET /features-flags/:id/labels */
    @get('/features-flags/{id}/labels')
    @authorize({ allowedRoles: ['pa_editor', 'admin'] })
    async listLabels(
        @param.path.number('id') id: number,
    ): Promise<FeatureFlagI18n[]> {
        return this.flagRepo.labels(id).find();
    }

    /** PUT /features-flags/:id/labels/:lang  — upsert a single label */
    @post('/features-flags/{id}/labels/{lang}')
    @authorize({ allowedRoles: ['admin'] })
    async upsertLabel(
        @param.path.number('id') id: number,
        @param.path.string('lang') lang: string,
        @requestBody() body: { label: string },
    ): Promise<FeatureFlagI18n> {
        this.logger.info(`[features-flags.upsertLabel] id=${id} lang=${lang}`);

        // Ensure the flag exists
        await this.flagRepo.findById(id);

        const existing = await this.i18nRepo.findOne({ where: { flagId: id, lang } });
        if (existing) {
            await this.i18nRepo.updateAll({ label: body.label }, { flagId: id, lang });
            return this.i18nRepo.findOne({ where: { flagId: id, lang } }) as Promise<FeatureFlagI18n>;
        }

        return this.i18nRepo.create({ flagId: id, lang, label: body.label });
    }

    /** DELETE /features-flags/:id/labels/:lang */
    @del('/features-flags/{id}/labels/{lang}')
    @authorize({ allowedRoles: ['admin'] })
    async deleteLabel(
        @param.path.number('id') id: number,
        @param.path.string('lang') lang: string,
    ): Promise<void> {
        const count = await this.i18nRepo.deleteAll({ flagId: id, lang });
        if (count.count === 0) {
            throw new HttpErrors.NotFound(`Label not found for flag ${id} lang ${lang}`);
        }
    }
}