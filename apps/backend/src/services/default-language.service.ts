/**
 * Resolves the single official language configured for the MICADO instance.
 *
 * `languages.is_default` is the only source of truth. Missing, duplicated or
 * inactive defaults are configuration errors: callers must not continue with
 * an inferred or hardcoded language.
 */
import {BindingScope, inject, injectable} from '@loopback/core';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {Language} from '../models';
import {LanguageRepository} from '../repositories';

@injectable({scope: BindingScope.SINGLETON})
export class DefaultLanguageService {
    constructor(
        @repository(LanguageRepository)
        private readonly languageRepository: LanguageRepository,

        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

  /**
   * Returns the unique active language marked as the platform default.
   *
   * @throws HttpErrors.ServiceUnavailable when the instance has no default,
   * more than one default, or an inactive default.
   */
    async getDefaultLanguage(): Promise<Language> {
        const defaults = await this.languageRepository.find({
            where: { isDefault: true },
            order: ['sortOrder ASC', 'lang ASC'],
        });

        if (defaults.length !== 1) {
            this.logger.error('[DefaultLanguageService] invalid default language configuration', {
                defaultCount: defaults.length,
                languages: defaults.map(language => language.lang),
            });
            throw new HttpErrors.ServiceUnavailable(
                `MICADO requires exactly one default language; found ${defaults.length}`,
            );
        }

        const language = defaults[0]!;
        if (!language.active) {
            this.logger.error('[DefaultLanguageService] default language is inactive', {
                lang: language.lang,
            });
            throw new HttpErrors.ServiceUnavailable(
                `MICADO default language '${language.lang}' is inactive`,
            );
        }

        this.logger.debug('[DefaultLanguageService] default language resolved', {
            lang: language.lang,
        });
        return language;
    }

    /** Returns only the language code for backend consumers. */
    async getDefaultLanguageCode(): Promise<string> {
        return (await this.getDefaultLanguage()).lang;
    }

    /**
     * Resolves the official language and rejects attempts to override it through
     * the legacy `defaultlang` query parameter.
     */
    async resolveDefaultLanguageCode(requested?: string): Promise<string> {
        const official = await this.getDefaultLanguageCode();
        if (requested && requested !== official) {
            throw new HttpErrors.BadRequest(
                `Requested default language '${requested}' does not match MICADO default language '${official}'`,
            );
        }
        return official;
    }
}
