import {apiPost} from './client';

export type TranslationChipState = 'MISSING' | 'SENT' | 'TRANSLATED';

export interface TranslationListFields {
    revisionId?: string;
    revisionNo?: number;
    translationStates?: Record<string, TranslationChipState>;
}

export interface DispatchMissingResult {
    revisionId: string;
    dispatched: string[];
    alreadyTranslated: string[];
    alreadyQueued: string[];
}

export function dispatchMissingTranslations(revisionId: string): Promise<DispatchMissingResult> {
    return apiPost(`/api/translations/revisions/${encodeURIComponent(revisionId)}/dispatch-missing`, {});
}
