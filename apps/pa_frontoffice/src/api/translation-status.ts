/** Translation lifecycle values persisted by content_revision_translation.t_status. */
export type TranslationLifecycleStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/** Three-state projection used by data-management list chips. */
export type TranslationSummaryState = 'MISSING' | 'SENT' | 'TRANSLATED';

export interface WithTranslationStatuses {
    translationStatuses?: Record<string, TranslationLifecycleStatus>;
}
