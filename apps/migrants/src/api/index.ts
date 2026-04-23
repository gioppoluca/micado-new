/**
 * src/api/index.ts
 *
 * Barrel export — import everything from 'src/api' in page/store files.
 *
 * Examples:
 *   import { languageApi }            from 'src/api';
 *   import { settingsApi }            from 'src/api';
 *   import type { Language }          from 'src/api';
 *   import { isApiError, type ApiError } from 'src/api';
 */

// ─── Core ─────────────────────────────────────────────────────────────────────

export { apiClient, isApiError } from './client';
export type { ApiError } from './client';

export { isMockEnabled } from './mock';

// ─── Infrastructure APIs (shared) ─────────────────────────────────────────────

export { languageApi } from './language.api';
export type {
    Language,
    CreateLanguagePayload,
    PatchLanguagePayload,
    LanguageListParams,
} from './language.api';

export { settingsApi } from './settings.api';
export type { PublicSetting } from './settings.api';

// ─── Migrant content APIs (public endpoints) ──────────────────────────────────

export { topicApi } from './topic.api';
export type { MigrantTopic, TopicMigrantParams } from './topic.api';

export { categoryApi } from './category.api';
export type {
    MigrantCategory,
    CategoryMigrantParams,
    CategorySubtype,
} from './category.api';

export { informationApi } from './information.api';
export type { MigrantInformation, InformationMigrantParams } from './information.api';

export { eventApi } from './event.api';
export type { MigrantEvent, EventMigrantParams } from './event.api';

export { glossaryApi } from './glossary.api';
export type { MigrantGlossaryTerm, GlossaryMigrantParams } from './glossary.api';

export { processApi } from './process.api';
export type { MigrantProcess, ProcessMigrantParams } from './process.api';
// ─── Document Wallet (authenticated migrant) ──────────────────────────────────
export { documentApi, buildDataUri } from './document.api';
export type {
    MigrantDocument,
    MigrantDocumentSummary,
    UploadDocumentPayload,
    UpdateDocumentPayload,
} from './document.api';
