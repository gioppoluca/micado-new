/**
 * src/api/index.ts
 *
 * Barrel export — import everything from 'src/api' in page/store files.
 */

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

// ── Micado entities (required by rich-text editor mention system) ──────────────
export { micadoEntitiesApi } from './micado-entities.api';
export type {
    MicadoEntity,
    EntityTranslation,
    EntityListParams,
} from './micado-entities.api';

// ── NGO user management ───────────────────────────────────────────────────────
export { ngoUsersApi } from './ngo-users.api';
export type {
    NgoUser,
    NgoRealmRole,
    CreateNgoUserPayload,
    UpdateNgoUserRolesPayload,
} from './ngo-users.api';

// ── Content types used by InformationPage and EventsPage ─────────────────────
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

export { userTypeApi } from './user-type.api';
export type {
    UserType,
    UserTypeFull,
    UserTypeTranslation,
    UserTypeStatus,
    CreateUserTypePayload,
    PatchUserTypePayload,
} from './user-type.api';

// ── NGO process comments ──────────────────────────────────────────────────────
export { ngoProcessCommentApi } from './ngo-process-comment.api';
export type {
    NgoProcessComment,
    CreateNgoCommentPayload,
    UpdateNgoCommentPayload,
} from './ngo-process-comment.api';

// ── Processes (read-only for NGO — used by NgoProcessesPage) ─────────────────
export { processApi, processStatusKey } from './process.api';
export type {
    Process,
    ProcessFull,
    ProcessListFilter,
} from './process.api';
