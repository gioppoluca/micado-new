/**
 * src/api/index.ts
 *
 * Barrel export — importa tutto da 'src/api' nei file page/store.
 *
 * ── MODIFICA rispetto all'originale ─────────────────────────────────────────
 * Aggiunti gli export di micado-entities.api (nuovo modulo per il rich-text editor).
 * Aggiunto translation-monitor.api (monitor pagina Settings → Translations).
 *
 * Examples:
 *   import { languageApi }              from 'src/api';
 *   import { micadoEntitiesApi }        from 'src/api';
 *   import type { MicadoEntity }        from 'src/api';
 *   import { isApiError, type ApiError } from 'src/api';
 */

// ── Originali (invariati) ─────────────────────────────────────────────────────
export { apiClient, isApiError } from './client';
export type { ApiError } from './client';

export { languageApi } from './language.api';
export type {
    Language,
    CreateLanguagePayload,
    PatchLanguagePayload,
    LanguageListParams,
} from './language.api';

export { settingsApi } from './settings.api';
export type { PublicSetting } from './settings.api';

export { isMockEnabled } from './mock';
export { featuresApi } from './features.api';
export type { FeatureFlag, PatchFeatureFlagPayload } from './features.api';

// ── Nuovo: entità MICADO per il rich-text editor ──────────────────────────────
export { micadoEntitiesApi } from './micado-entities.api';
export type {
    MicadoEntity,
    EntityTranslation,
    EntityListParams,
} from './micado-entities.api';

// ── Topics ────────────────────────────────────────────────────────────────────
export { topicApi, toTreeNodes, topicStatusKey } from './topic.api';
export type {
    Topic,
    TopicFull,
    TopicTranslation,
    TopicDataExtra,
    TopicStatus,
    TopicTreeNode,
    CreateTopicPayload,
    PatchTopicPayload,
} from './topic.api';

// ── Glossary ──────────────────────────────────────────────────────────────────
export { glossaryApi, parseCsvRows, glossaryStatusKey } from './glossary.api';
export type {
    GlossaryTerm,
    GlossaryFull,
    GlossaryTranslation,
    GlossaryStatus,
    CreateGlossaryPayload,
    PatchGlossaryPayload,
    CsvParseResult,
} from './glossary.api';

// ── Category ──────────────────────────────────────────────────────────────────
export { categoryApi, categoryStatusKey } from './category.api';
export type {
    Category,
    CategoryFull,
    CategoryTranslation,
    CategoryStatus,
    CategorySubtype,
    CreateCategoryPayload,
    PatchCategoryPayload,
} from './category.api';

// ── Event ─────────────────────────────────────────────────────────────────────
export { eventApi, eventStatusKey } from './event.api';
export type {
    Event,
    EventFull,
    EventTranslation,
    EventDataExtra,
    EventStatus,
    EventListFilter,
    CreateEventPayload,
    PatchEventPayload,
} from './event.api';

// ── Process ───────────────────────────────────────────────────────────────────
export { processApi, processStatusKey } from './process.api';
export type {
    Process,
    ProcessFull,
    ProcessTranslation,
    ProcessStatus,
    ProcessListFilter,
    CreateProcessPayload,
    PatchProcessPayload,
    ProcessGraph,
    ProcessNode,
    ProcessEdge,
    GraphNodeData,
    GraphEdgeData,
    GraphNodeTranslation,
    GraphEdgeTranslation,
    RequiredDocument,
} from './process.api';

export { informationApi, informationStatusKey } from './information.api';
export type {
    Information,
    InformationFull,
    InformationTranslation,
    InformationStatus,
    InformationListFilter,
    CreateInformationPayload,
    PatchInformationPayload,
} from './information.api';

export * from './analytics.api';
export { analyticsApi } from './analytics.api';

// ── Translation workflow monitor ──────────────────────────────────────────────
export { translationMonitorApi } from './translation-monitor.api';
export type {
    TranslationStatus,
    LangStatusEntry,
    WorkflowSummary,
    StagedCommitSummary,
    TranslationMonitorSnapshot,
} from './translation-monitor.api';
export { ngoOrganizationsApi } from './ngo-organizations.api';
export type {
    NgoOrganization,
    NgoUser,
    CreateNgoOrganizationPayload,
    CreateNgoUserPayload,
    UpdateNgoUserRolesPayload,
} from './ngo-organizations.api';

export { paUsersApi } from './pa-users.api';
export type {
    PaUser,
    KeycloakRealmRole,
    CreatePaUserPayload,
    UpdatePaUserRolesPayload,
} from './pa-users.api';