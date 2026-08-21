import {BindingScope, inject, injectable} from '@loopback/core';
import {repository} from '@loopback/repository';
import {ContentRevision, ContentRevisionTranslation} from '../models';
import {LanguageRepository} from '../repositories';
import {TranslationWorkflowOrchestratorService} from './translation-workflow-orchestrator.service';

export type TranslationChipState = 'MISSING' | 'SENT' | 'TRANSLATED';

const SENT_STATES = new Set([
    'WAITING_TRANSLATION', 'RECEIVED_TRANSLATION', 'GENERATING_MP3', 'SAVING_TO_DB',
]);

@injectable({scope: BindingScope.TRANSIENT})
export class TranslationStateProjectionService {
    private activeLanguagesPromise?: Promise<string[]>;

    constructor(
        @repository(LanguageRepository) private readonly languages: LanguageRepository,
        @inject(TranslationWorkflowOrchestratorService.BINDING) private readonly workflows: TranslationWorkflowOrchestratorService,
    ) {}

    async project(
        revision: ContentRevision,
        rows: ContentRevisionTranslation[],
    ): Promise<Record<string, TranslationChipState>> {
        // One language query per list request, not one per content row.
        this.activeLanguagesPromise ??= this.languages
            .find({where: {active: true}})
            .then(languages => languages.map(language => language.lang));
        const active = await this.activeLanguagesPromise;
        const result: Record<string, TranslationChipState> = {};
        await Promise.all(active.map(async lang => {
            if (lang === revision.sourceLang) return;
            const row = rows.find(candidate => candidate.lang === lang);
            if (row && (row.tStatus === 'APPROVED' || row.tStatus === 'PUBLISHED')) {
                result[lang] = 'TRANSLATED';
                return;
            }
            const status = await this.workflows.getLanguageWorkflowStatus(revision.id!, lang);
            result[lang] = status && SENT_STATES.has(status) ? 'SENT' : 'MISSING';
        }));
        return result;
    }
}
